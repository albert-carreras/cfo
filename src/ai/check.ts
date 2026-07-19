import { z } from "zod";

const RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5.6-sol";

export type HealthVerdict = "ok" | "watch" | "update";

export type HealthCheckSummary = {
  asOf: string;
  deterministicVerdict: HealthVerdict;
  metrics: {
    netWorthEUR: string;
    liquidEUR: string;
    investableEUR: string;
    lockedEUR: string;
    propertyEquityEUR: string;
    debtEUR: string;
    monthlySpendEUR: string;
    safeMonthlySpendEUR: string | null;
    runwayYears: number | null;
    basePlanHolds: boolean | null;
    conservativePlanHolds: boolean | null;
  };
  data: {
    score: string;
    missing: string[];
    flags: string[];
  };
  plans: {
    type: string;
    date: string;
    amountEUR: string;
    note: string | null;
  }[];
  concentrations: string[];
};

const rawReportSchema = z.object({
  verdict: z.enum(["ok", "watch", "update"]),
  headline: z.string().trim().min(1).max(220),
  observations: z.array(z.string().trim().min(1).max(320)).max(3),
});

export type HealthCheckReport = z.infer<typeof rawReportSchema>;

export const healthCheckJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "headline", "observations"],
  properties: {
    verdict: { type: "string", enum: ["ok", "watch", "update"] },
    headline: { type: "string", minLength: 1, maxLength: 220 },
    observations: {
      type: "array",
      maxItems: 3,
      items: { type: "string", minLength: 1, maxLength: 320 },
    },
  },
} as const;

const HAS_DIGIT = /\d/;

// The voice stays qualitative. Figures already exist in the deterministic
// panel; dropping digit-bearing prose prevents an LLM calculation from
// masquerading as a verified personal number.
export function validateHealthCheck(value: unknown): HealthCheckReport {
  const parsed = rawReportSchema.parse(value);
  const observations = parsed.observations.filter((text) => !HAS_DIGIT.test(text));
  const headline = HAS_DIGIT.test(parsed.headline)
    ? "The latest financial check is complete."
    : parsed.headline;
  return { ...parsed, headline, observations };
}

export function buildHealthCheckRequestBody(
  summary: HealthCheckSummary,
  model = DEFAULT_MODEL,
) {
  return {
    model,
    store: false,
    max_output_tokens: 1_000,
    instructions: `You are the quiet monthly checker for a personal financial record.

Goal: decide whether the current picture is broadly okay, worth watching, or needs a data update.

Rules:
- Use only the supplied summary.
- Do not browse, recommend trades, solve scenarios, or tell the user what to buy or sell.
- Do not write any digits or repeat any amounts. The interface renders every number deterministically.
- Give one direct headline and at most three short observations.
- Distinguish current-position health, future plans, and data readiness.
- A recorded major plan without a financing description is worth watching, not an emergency.
- Missing or stale decision-critical data should produce update.
- Calm is welcome; generic reassurance is not.`,
    input: JSON.stringify(summary),
    text: {
      format: {
        type: "json_schema",
        name: "health_check",
        strict: true,
        schema: healthCheckJsonSchema,
      },
    },
  };
}

type FetchLike = (
  input: string,
  init: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

export async function runHealthCheckModel(options: {
  apiKey: string;
  summary: HealthCheckSummary;
  model?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<{ report: HealthCheckReport; model: string }> {
  const model = options.model ?? DEFAULT_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
  try {
    const response = await fetchImpl(RESPONSES_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(buildHealthCheckRequestBody(options.summary, model)),
      signal: controller.signal,
    });
    const payload = (await response.json()) as {
      error?: { message?: string };
      output?: {
        type?: string;
        content?: { type?: string; text?: string }[];
      }[];
    };
    if (!response.ok) {
      throw new Error(payload.error?.message ?? `provider returned ${response.status}`);
    }
    const text = payload.output
      ?.flatMap((item) => item.content ?? [])
      .find((item) => item.type === "output_text")?.text;
    if (!text) throw new Error("provider returned no output text");
    return { report: validateHealthCheck(JSON.parse(text)), model };
  } finally {
    clearTimeout(timeout);
  }
}
