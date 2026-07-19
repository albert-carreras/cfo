import { describe, expect, it, vi } from "vitest";
import {
  AskProviderError,
  buildRequestBody,
  createOpenAiAskClient,
  extractFunctionCalls,
  type FetchLike,
} from "@/ai/openai";
import type { AskContext } from "@/ai/types";

// The provider-side tool loop: function_call rounds execute the server's
// deterministic tools and resend the whole thread (store:false), the final
// round returns the schema-constrained answer. All from fixtures, no network.

const answerJson = JSON.stringify({
  statements: [
    {
      label: "calculated",
      text: "The payment is {{tool.1.monthlyPaymentEUR}}.",
      citations: ["snap_x"],
    },
  ],
  suggestsReview: false,
  requiresManualReview: true,
});

const functionCallItem = {
  type: "function_call",
  call_id: "call_1",
  name: "mortgage_terms",
  arguments: '{"principalEUR":300000,"rateAnnualPct":3,"termYears":25}',
};

const finalPayload = {
  output: [
    { type: "message", content: [{ type: "output_text", text: answerJson }] },
  ],
};

function scriptedFetch(payloads: unknown[]): {
  fetchImpl: FetchLike;
  bodies: () => unknown[];
} {
  const sent: unknown[] = [];
  let i = 0;
  const fetchImpl: FetchLike = async (_url, init) => {
    sent.push(JSON.parse(init.body as string));
    const payload = payloads[Math.min(i, payloads.length - 1)];
    i += 1;
    return { ok: true, status: 200, json: async () => payload };
  };
  return { fetchImpl, bodies: () => sent };
}

function contextWithTooling(
  execute: AskContext["tooling"] extends infer T
    ? T extends { execute: infer E }
      ? E
      : never
    : never,
): AskContext {
  return {
    instructions: "test",
    input: '{"question":"how much mortgage?"}',
    metrics: [],
    allowedCitations: ["snap_x"],
    citationLabels: {},
    tooling: {
      definitions: [
        {
          name: "mortgage_terms",
          description: "d",
          parameters: { type: "object" },
        },
      ],
      execute,
    },
  };
}

describe("extractFunctionCalls", () => {
  it("finds function_call items and keeps the raw item for resending", () => {
    const calls = extractFunctionCalls({
      output: [functionCallItem, { type: "message", content: [] }],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].callId).toBe("call_1");
    expect(calls[0].name).toBe("mortgage_terms");
    expect(calls[0].item).toBe(functionCallItem);
  });

  it("is empty on tool-less payloads", () => {
    expect(extractFunctionCalls(finalPayload)).toEqual([]);
    expect(extractFunctionCalls({})).toEqual([]);
  });
});

describe("createOpenAiAskClient tool loop", () => {
  it("executes the call, resends the thread, and returns the final answer", async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ ok: true, output: { metrics: [] } });
    const ctx = contextWithTooling(execute);
    const { fetchImpl, bodies } = scriptedFetch([
      { output: [functionCallItem] },
      finalPayload,
    ]);
    const client = createOpenAiAskClient({ apiKey: "k", fetchImpl });

    const outcome = await client.ask(ctx);
    expect(outcome.answer.statements[0].text).toContain(
      "{{tool.1.monthlyPaymentEUR}}",
    );
    expect(execute).toHaveBeenCalledWith("mortgage_terms", {
      principalEUR: 300000,
      rateAnnualPct: 3,
      termYears: 25,
    });

    const sent = bodies() as { input: unknown; tools?: unknown[] }[];
    expect(sent).toHaveLength(2);
    // Both rounds carry the tool definitions; the second resends the call and
    // its output in the thread.
    expect(sent[0].tools).toHaveLength(1);
    const thread = sent[1].input as { type?: string; call_id?: string }[];
    expect(thread.some((t) => t.type === "function_call")).toBe(true);
    expect(
      thread.some((t) => t.type === "function_call_output" && t.call_id === "call_1"),
    ).toBe(true);
  });

  it("feeds executor errors back to the model instead of failing the ask", async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "unknown scenario id" });
    const ctx = contextWithTooling(execute);
    const { fetchImpl, bodies } = scriptedFetch([
      { output: [functionCallItem] },
      finalPayload,
    ]);
    const client = createOpenAiAskClient({ apiKey: "k", fetchImpl });

    const outcome = await client.ask(ctx);
    expect(outcome.answer.statements).toHaveLength(1);
    const thread = (bodies()[1] as { input: { type?: string; output?: string }[] })
      .input;
    const toolOutput = thread.find((t) => t.type === "function_call_output");
    expect(toolOutput?.output).toContain("unknown scenario id");
  });

  it("throws after the round limit instead of looping forever", async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ ok: true, output: {} });
    const ctx = contextWithTooling(execute);
    // The provider keeps calling tools on every round.
    const { fetchImpl } = scriptedFetch([{ output: [functionCallItem] }]);
    const client = createOpenAiAskClient({ apiKey: "k", fetchImpl });

    await expect(client.ask(ctx)).rejects.toThrow(AskProviderError);
    await expect(
      createOpenAiAskClient({ apiKey: "k", fetchImpl }).ask(ctx),
    ).rejects.toThrow(/round limit/);
  });

  it("ignores function calls entirely when the context carries no tooling", async () => {
    const ctx: AskContext = {
      instructions: "test",
      input: "{}",
      metrics: [],
      allowedCitations: [],
      citationLabels: {},
    };
    const { fetchImpl, bodies } = scriptedFetch([finalPayload]);
    const client = createOpenAiAskClient({ apiKey: "k", fetchImpl });
    await client.ask(ctx);
    expect(
      (bodies()[0] as { tools?: unknown }).tools,
    ).toBeUndefined();
    expect(buildRequestBody(ctx, "m")).not.toHaveProperty("tools");
  });
});
