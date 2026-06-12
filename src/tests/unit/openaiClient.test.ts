import { describe, expect, it } from "vitest";
import {
  AskProviderError,
  buildRequestBody,
  buildPictureRequestBody,
  buildReviewRequestBody,
  createOpenAiAskClient,
  createOpenAiPictureClient,
  createOpenAiReviewClient,
  parseResponsesPayload,
  type FetchLike,
} from "@/ai/openai";
import type { AskAnswer, AskContext, ReviewContext, ReviewReport } from "@/ai/types";

const ctx: AskContext = {
  instructions: "rules",
  input: '{"question":"runway?"}',
  metrics: [],
  allowedCitations: ["snap_1"],
  citationLabels: { snap_1: "Strategic snapshot" },
};

const validAnswer: AskAnswer = {
  statements: [{ label: "judgment", text: "Looks calm.", citations: [] }],
  suggestsReview: false,
  requiresManualReview: false,
};

const okPayload = {
  status: "completed",
  output: [
    {
      type: "message",
      content: [{ type: "output_text", text: JSON.stringify(validAnswer) }],
    },
  ],
};

function fetchReturning(status: number, payload: unknown): FetchLike {
  return async () => ({ ok: status < 300, status, json: async () => payload });
}

describe("buildRequestBody", () => {
  it("never lets the provider store the exchange, bounds output, constrains the schema", () => {
    const body = buildRequestBody(ctx, "gpt-5.5");
    expect(body.store).toBe(false); // privacy-critical: provider stores by default
    expect(body.max_output_tokens).toBeGreaterThan(0);
    expect(body.model).toBe("gpt-5.5");
    expect(body.text.format).toMatchObject({
      type: "json_schema",
      name: "ask_answer",
      strict: true,
    });
  });
});

describe("parseResponsesPayload", () => {
  it("extracts the answer text from a completed response", () => {
    expect(parseResponsesPayload(okPayload)).toEqual({
      ok: true,
      text: JSON.stringify(validAnswer),
    });
  });

  it.each([
    [{ error: { message: "rate limited" } }, "provider error"],
    [{ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }, "incomplete"],
    [
      { output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] },
      "refusal",
    ],
    [{ output: [] }, "no output_text"],
    [null, "no output_text"],
  ])("fails closed on %j", (payload, reason) => {
    const result = parseResponsesPayload(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(reason);
  });
});

describe("createOpenAiAskClient", () => {
  it("sends store:false with the key and parses a valid answer", async () => {
    let sent: { url: string; init: RequestInit } | null = null;
    const fetchImpl: FetchLike = async (url, init) => {
      sent = { url, init };
      return { ok: true, status: 200, json: async () => okPayload };
    };
    const client = createOpenAiAskClient({ apiKey: "sk-test", fetchImpl });

    const { answer, model } = await client.ask(ctx);
    expect(answer).toEqual(validAnswer);
    expect(model).toBe("gpt-5.5");

    const { url, init } = sent!;
    expect(url).toContain("/v1/responses");
    const body = JSON.parse(init.body as string);
    expect(body.store).toBe(false);
    expect(body.input).toBe(ctx.input);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    expect(init.signal).toBeInstanceOf(AbortSignal); // timeout always attached
  });

  it.each([
    ["non-2xx", fetchReturning(500, {})],
    ["refusal", fetchReturning(200, { output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] })],
    [
      "malformed JSON text",
      fetchReturning(200, {
        output: [{ type: "message", content: [{ type: "output_text", text: "not json" }] }],
      }),
    ],
    [
      "schema-violating answer",
      fetchReturning(200, {
        output: [
          { type: "message", content: [{ type: "output_text", text: '{"statements":[]}' }] },
        ],
      }),
    ],
  ])("throws AskProviderError on %s", async (_name, fetchImpl) => {
    const client = createOpenAiAskClient({ apiKey: "sk-test", fetchImpl });
    await expect(client.ask(ctx)).rejects.toBeInstanceOf(AskProviderError);
  });
});

// --- the review client ---

const reviewCtx: ReviewContext = {
  ...ctx,
  month: "2026-06",
  triggers: [],
  revisited: [],
};

const validReport: ReviewReport = {
  digest: [{ label: "judgment", text: "All calm this month.", citations: [] }],
  decisionsRevisited: [],
  findings: [],
  taxTables: { verdict: "unverified", proposedVersion: null, notes: "", sources: [] },
  recommendation: null,
  suggestsReview: false,
};

const okReviewPayload = {
  status: "completed",
  output: [
    { type: "web_search_call", status: "completed" }, // research items are skipped
    {
      type: "message",
      content: [{ type: "output_text", text: JSON.stringify(validReport) }],
    },
  ],
};

describe("buildPictureRequestBody", () => {
  it("is ask-shaped — no tools, store:false, schema-constrained, longer leash", () => {
    const body = buildPictureRequestBody(ctx, "gpt-5.5");
    expect(body.store).toBe(false);
    expect("tools" in body).toBe(false);
    expect(body.max_output_tokens).toBeGreaterThan(buildRequestBody(ctx, "gpt-5.5").max_output_tokens);
    expect(body.text.format).toMatchObject({
      type: "json_schema",
      name: "picture_narrative",
      strict: true,
    });
  });
});

describe("createOpenAiPictureClient", () => {
  const narrative = {
    sections: [
      {
        heading: "The situation",
        statements: [{ label: "judgment", text: "Calm.", citations: [] }],
      },
    ],
  };

  it("parses a valid narrative", async () => {
    const client = createOpenAiPictureClient({
      apiKey: "k",
      fetchImpl: fetchReturning(200, {
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(narrative) }],
          },
        ],
      }),
    });
    const result = await client.picture(ctx);
    expect(result.narrative.sections[0].heading).toBe("The situation");
  });

  it("throws AskProviderError on a schema-violating narrative", async () => {
    const client = createOpenAiPictureClient({
      apiKey: "k",
      fetchImpl: fetchReturning(200, {
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: '{"sections":[]}' }],
          },
        ],
      }),
    });
    await expect(client.picture(ctx)).rejects.toBeInstanceOf(AskProviderError);
  });
});

describe("buildReviewRequestBody", () => {
  it("is the ask request plus the web-search tool — still store:false, still schema-constrained", () => {
    const body = buildReviewRequestBody(reviewCtx, "gpt-5.5");
    expect(body.store).toBe(false);
    expect(body.tools).toEqual([{ type: "web_search" }]);
    expect(body.text.format).toMatchObject({
      type: "json_schema",
      name: "review_report",
      strict: true,
    });
  });

  it("the ask request carries NO tools — web research happens only inside the review", () => {
    expect("tools" in buildRequestBody(ctx, "gpt-5.5")).toBe(false);
  });
});

describe("createOpenAiReviewClient", () => {
  it("parses a report past the web_search_call items", async () => {
    const client = createOpenAiReviewClient({
      apiKey: "sk-test",
      fetchImpl: fetchReturning(200, okReviewPayload),
    });
    const { report, model } = await client.review(reviewCtx);
    expect(report).toEqual(validReport);
    expect(model).toBe("gpt-5.5");
  });

  it("throws AskProviderError on a schema-violating report", async () => {
    const client = createOpenAiReviewClient({
      apiKey: "sk-test",
      fetchImpl: fetchReturning(200, {
        output: [
          { type: "message", content: [{ type: "output_text", text: '{"digest":[]}' }] },
        ],
      }),
    });
    await expect(client.review(reviewCtx)).rejects.toBeInstanceOf(AskProviderError);
  });
});
