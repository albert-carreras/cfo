import { askAnswerJsonSchema, askAnswerSchema } from "./schema";
import { reviewReportJsonSchema, reviewReportSchema } from "./reviewSchema";
import { pictureNarrativeJsonSchema, pictureNarrativeSchema } from "./pictureSchema";
import {
  quicklogExtractionJsonSchema,
  quicklogExtractionSchema,
} from "./quicklogSchema";
import type { QuicklogParseContext } from "./quicklogContext";
import type {
  AskClient,
  AskContext,
  PictureClient,
  PictureContext,
  QuicklogParseClient,
  ReviewClient,
  ReviewContext,
} from "./types";

// The ONLY provider-specific file (principle #13 — the provider is recorded in
// docs/architecture.md and lives behind src/ai/index.ts). One hand-written
// fetch to the Responses API so the box's single egress stays auditable; no
// SDK. `store: false` always — answers about the user are never retained by
// the provider.

const RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5.6";
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_TOKENS = 2_000;
// Tool-call rounds an Ask may take before it must answer (each round is one
// provider request; the deterministic executors themselves are local and
// fast). Exceeding it is a provider error, never a silent partial answer.
const MAX_TOOL_ROUNDS = 4;
// The monthly review researches the web inside one call, so it gets a longer
// leash than an interactive Ask — it runs from cron, nobody is waiting on it.
const REVIEW_TIMEOUT_MS = 300_000;
const REVIEW_MAX_OUTPUT_TOKENS = 8_000;
// The picture is a verbose standing essay generated off the request path (cron
// promotion or an explicit refresh) — longer than an Ask answer, no web tools.
const PICTURE_TIMEOUT_MS = 120_000;
const PICTURE_MAX_OUTPUT_TOKENS = 6_000;
// The quick-log parser is interactive (someone is mid-form) and tiny — a short
// leash and a small bound keep it snappy; failure falls back to manual forms.
const QUICKLOG_TIMEOUT_MS = 20_000;
const QUICKLOG_MAX_OUTPUT_TOKENS = 1_000;

export type FetchLike = (
  url: string,
  init: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

export class AskProviderError extends Error {}

export function buildRequestBody(
  ctx: AskContext,
  model: string,
  // The running conversation once tool rounds start: the original input plus
  // the function_call items and their outputs, resent whole (store:false —
  // nothing lives server-side between rounds).
  input?: unknown,
) {
  return {
    model,
    instructions: ctx.instructions,
    input: input ?? ctx.input,
    store: false, // privacy-critical: the provider stores responses by default
    max_output_tokens: MAX_OUTPUT_TOKENS,
    ...(ctx.tooling && ctx.tooling.definitions.length > 0
      ? {
          tools: ctx.tooling.definitions.map((d) => ({
            type: "function",
            name: d.name,
            description: d.description,
            parameters: d.parameters,
          })),
        }
      : {}),
    text: {
      format: {
        type: "json_schema",
        name: "ask_answer",
        strict: true,
        schema: askAnswerJsonSchema,
      },
    },
  };
}

// The review request is the Ask request plus the provider's web-search tool —
// the ONLY request that carries one (web research happens inside the review,
// nowhere else). Still store:false, still schema-constrained.
export function buildReviewRequestBody(ctx: ReviewContext, model: string) {
  return {
    model,
    instructions: ctx.instructions,
    input: ctx.input,
    store: false,
    max_output_tokens: REVIEW_MAX_OUTPUT_TOKENS,
    tools: [{ type: "web_search" }],
    text: {
      format: {
        type: "json_schema",
        name: "review_report",
        strict: true,
        schema: reviewReportJsonSchema,
      },
    },
  };
}

// The picture request is Ask-shaped (no tools — the narrative is grounded in
// the metrics alone) with a longer output bound. Still store:false, still
// schema-constrained.
export function buildPictureRequestBody(ctx: PictureContext, model: string) {
  return {
    model,
    instructions: ctx.instructions,
    input: ctx.input,
    store: false,
    max_output_tokens: PICTURE_MAX_OUTPUT_TOKENS,
    text: {
      format: {
        type: "json_schema",
        name: "picture_narrative",
        strict: true,
        schema: pictureNarrativeJsonSchema,
      },
    },
  };
}

// The parser request: no tools, the smallest bound, the same store:false and
// strict schema discipline. The input carries only the user's typed text.
export function buildQuicklogRequestBody(
  ctx: QuicklogParseContext,
  model: string,
) {
  return {
    model,
    instructions: ctx.instructions,
    input: ctx.input,
    store: false,
    max_output_tokens: QUICKLOG_MAX_OUTPUT_TOKENS,
    text: {
      format: {
        type: "json_schema",
        name: "quicklog_extraction",
        strict: true,
        schema: quicklogExtractionJsonSchema,
      },
    },
  };
}

type ResponsesPayload = {
  status?: string;
  error?: { message?: string } | null;
  incomplete_details?: { reason?: string } | null;
  output?: {
    type?: string;
    content?: { type?: string; text?: string; refusal?: string }[];
  }[];
};

// Function calls the model made this round. The raw item is kept so it can be
// resent verbatim next round (the Responses API matches outputs by call_id).
export type ExtractedFunctionCall = {
  callId: string;
  name: string;
  argumentsJson: string;
  item: unknown;
};

export function extractFunctionCalls(payload: unknown): ExtractedFunctionCall[] {
  const p = payload as {
    output?: { type?: string; call_id?: string; name?: string; arguments?: string }[];
  };
  return (p?.output ?? [])
    .filter(
      (i) =>
        i.type === "function_call" &&
        typeof i.call_id === "string" &&
        typeof i.name === "string",
    )
    .map((i) => ({
      callId: i.call_id as string,
      name: i.name as string,
      argumentsJson: i.arguments ?? "{}",
      item: i,
    }));
}

// Pure extraction so refusals / incomplete output / malformed payloads are
// unit-testable from fixtures without network.
export function parseResponsesPayload(
  payload: unknown,
): { ok: true; text: string } | { ok: false; reason: string } {
  const p = payload as ResponsesPayload;
  if (p?.error?.message) return { ok: false, reason: `provider error: ${p.error.message}` };
  if (p?.status === "incomplete")
    return {
      ok: false,
      reason: `incomplete output (${p.incomplete_details?.reason ?? "unknown"})`,
    };
  for (const item of p?.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "refusal")
        return { ok: false, reason: `refusal: ${content.refusal ?? ""}` };
      if (content.type === "output_text" && content.text)
        return { ok: true, text: content.text };
    }
  }
  return { ok: false, reason: "no output_text in response" };
}

export function createOpenAiAskClient(opts: {
  apiKey: string;
  model?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): AskClient {
  const model = opts.model ?? DEFAULT_MODEL;
  const fetchImpl: FetchLike = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async ask(ctx) {
      // The running conversation: the original input, then each round's
      // function_call items and their outputs. With store:false nothing lives
      // provider-side between rounds, so the whole thread is resent each time.
      const items: unknown[] = [{ role: "user", content: ctx.input }];

      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        const response = await fetchImpl(RESPONSES_URL, {
          method: "POST",
          headers: {
            authorization: `Bearer ${opts.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(buildRequestBody(ctx, model, items)),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok)
          throw new AskProviderError(
            `provider returned HTTP ${response.status}`,
          );
        const payload = await response.json();

        const calls = ctx.tooling ? extractFunctionCalls(payload) : [];
        if (calls.length > 0 && round >= MAX_TOOL_ROUNDS)
          throw new AskProviderError("tool loop exceeded the round limit");
        if (calls.length > 0) {
          for (const call of calls) {
            items.push(call.item);
            let args: unknown = null;
            try {
              args = JSON.parse(call.argumentsJson || "{}");
            } catch {
              // fall through to the error result below
            }
            const result =
              args === null
                ? { ok: false as const, error: "malformed arguments JSON" }
                : await ctx.tooling!.execute(call.name, args);
            items.push({
              type: "function_call_output",
              call_id: call.callId,
              output: JSON.stringify(
                result.ok ? result.output : { error: result.error },
              ),
            });
          }
          continue;
        }

        const extracted = parseResponsesPayload(payload);
        if (!extracted.ok) throw new AskProviderError(extracted.reason);

        let parsed: unknown;
        try {
          parsed = JSON.parse(extracted.text);
        } catch {
          throw new AskProviderError("provider returned malformed JSON");
        }
        const answer = askAnswerSchema.safeParse(parsed);
        if (!answer.success)
          throw new AskProviderError(
            "provider output failed the answer schema",
          );
        return { answer: answer.data, model };
      }
      throw new AskProviderError("tool loop exceeded the round limit");
    },
  };
}

export function createOpenAiPictureClient(opts: {
  apiKey: string;
  model?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): PictureClient {
  const model = opts.model ?? DEFAULT_MODEL;
  const fetchImpl: FetchLike = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? PICTURE_TIMEOUT_MS;

  return {
    async picture(ctx) {
      const response = await fetchImpl(RESPONSES_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${opts.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(buildPictureRequestBody(ctx, model)),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok)
        throw new AskProviderError(`provider returned HTTP ${response.status}`);

      const extracted = parseResponsesPayload(await response.json());
      if (!extracted.ok) throw new AskProviderError(extracted.reason);

      let parsed: unknown;
      try {
        parsed = JSON.parse(extracted.text);
      } catch {
        throw new AskProviderError("provider returned malformed JSON");
      }
      const narrative = pictureNarrativeSchema.safeParse(parsed);
      if (!narrative.success)
        throw new AskProviderError("provider output failed the narrative schema");
      return { narrative: narrative.data, model };
    },
  };
}

export function createOpenAiQuicklogClient(opts: {
  apiKey: string;
  model?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): QuicklogParseClient {
  const model = opts.model ?? DEFAULT_MODEL;
  const fetchImpl: FetchLike = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? QUICKLOG_TIMEOUT_MS;

  return {
    async parse(ctx) {
      const response = await fetchImpl(RESPONSES_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${opts.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(buildQuicklogRequestBody(ctx, model)),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok)
        throw new AskProviderError(`provider returned HTTP ${response.status}`);

      const extracted = parseResponsesPayload(await response.json());
      if (!extracted.ok) throw new AskProviderError(extracted.reason);

      let parsed: unknown;
      try {
        parsed = JSON.parse(extracted.text);
      } catch {
        throw new AskProviderError("provider returned malformed JSON");
      }
      const extraction = quicklogExtractionSchema.safeParse(parsed);
      if (!extraction.success)
        throw new AskProviderError("provider output failed the extraction schema");
      return { extraction: extraction.data, model };
    },
  };
}

export function createOpenAiReviewClient(opts: {
  apiKey: string;
  model?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): ReviewClient {
  const model = opts.model ?? DEFAULT_MODEL;
  const fetchImpl: FetchLike = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? REVIEW_TIMEOUT_MS;

  return {
    async review(ctx) {
      const response = await fetchImpl(RESPONSES_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${opts.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(buildReviewRequestBody(ctx, model)),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok)
        throw new AskProviderError(`provider returned HTTP ${response.status}`);

      // parseResponsesPayload skips non-message items, so the web_search_call
      // entries the research produces fall through to the final message.
      const extracted = parseResponsesPayload(await response.json());
      if (!extracted.ok) throw new AskProviderError(extracted.reason);

      let parsed: unknown;
      try {
        parsed = JSON.parse(extracted.text);
      } catch {
        throw new AskProviderError("provider returned malformed JSON");
      }
      const report = reviewReportSchema.safeParse(parsed);
      if (!report.success)
        throw new AskProviderError("provider output failed the report schema");
      return { report: report.data, model };
    },
  };
}
