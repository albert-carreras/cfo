import { z } from "zod";
import type { AskAnswer, AskContext, MetricEntry } from "./types";

// The structured-output contract and its deterministic enforcement. The model
// is constrained by JSON schema, then validated again here; statements that
// invent figures (raw digits) or cite outside the context are DROPPED — never
// relabelled — so a fabricated personal number can't reach the screen under
// any label.

export const askAnswerSchema = z
  .object({
    statements: z
      .array(
        z
          .object({
            label: z.enum(["verified", "calculated", "judgment"]),
            text: z.string().min(1),
            citations: z.array(z.string()),
          })
          .strict(),
      )
      .min(1),
    suggestsReview: z.boolean(),
    requiresManualReview: z.boolean(),
  })
  .strict();

// Schema-constrained proposals (Structured Outputs): strict objects, no
// additional properties — exported once so the provider client and the tests
// share the exact same contract.
export const askAnswerJsonSchema = z.toJSONSchema(askAnswerSchema);

const TOKEN = /\{\{([a-zA-Z0-9_.-]+)\}\}/g;

export function metricTokens(text: string): string[] {
  return [...text.matchAll(TOKEN)].map((m) => m[1]);
}

// Render {{metric-id}} tokens to their server-formatted values. Unknown tokens
// never survive validation, but render defensively anyway.
export function renderStatementText(
  text: string,
  metrics: MetricEntry[],
): string {
  const byId = new Map(metrics.map((m) => [m.id, m.value]));
  return text.replace(TOKEN, (whole, id: string) => byId.get(id) ?? whole);
}

// The same rendering, split into parts, so the UI can wrap each metric value
// (an amount about the user) in the hidden-figures toggle while the prose
// around it stays visible.
export type StatementPart =
  | { kind: "text"; value: string }
  | { kind: "metric"; value: string };

export function renderStatementParts(
  text: string,
  metrics: MetricEntry[],
): StatementPart[] {
  const byId = new Map(metrics.map((m) => [m.id, m.value]));
  const parts: StatementPart[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    if (match.index > last)
      parts.push({ kind: "text", value: text.slice(last, match.index) });
    const value = byId.get(match[1]);
    parts.push(
      value === undefined
        ? { kind: "text", value: match[0] }
        : { kind: "metric", value },
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });
  return parts;
}

export type ValidatedAnswer =
  | { ok: true; answer: AskAnswer; droppedStatements: number }
  | { ok: false; reason: "empty-after-validation" };

// Deterministic post-validation (principle #2 — the LLM never originates a
// number about the user):
//  - every {{token}} must name a context metric, else the statement is dropped;
//  - any raw digit OUTSIDE tokens drops the statement (figures only via tokens);
//  - citations are filtered to the allowed set; metric provenance is merged in;
//  - verified/calculated statements left uncited are dropped, not downgraded.
export function validateAnswer(
  answer: AskAnswer,
  ctx: Pick<AskContext, "metrics" | "allowedCitations">,
): ValidatedAnswer {
  const metricIds = new Set(ctx.metrics.map((m) => m.id));
  const metricCites = new Map(ctx.metrics.map((m) => [m.id, m.citations]));
  const allowed = new Set(ctx.allowedCitations);

  const statements = answer.statements.flatMap((statement) => {
    const tokens = metricTokens(statement.text);
    if (tokens.some((t) => !metricIds.has(t))) return [];
    if (/\d/.test(statement.text.replace(TOKEN, ""))) return [];
    const citations = [
      ...new Set([
        ...statement.citations.filter((c) => allowed.has(c)),
        ...tokens.flatMap((t) => metricCites.get(t) ?? []),
      ]),
    ];
    if (statement.label !== "judgment" && citations.length === 0) return [];
    return [{ ...statement, citations }];
  });

  if (statements.length === 0) return { ok: false, reason: "empty-after-validation" };
  return {
    ok: true,
    answer: { ...answer, statements },
    droppedStatements: answer.statements.length - statements.length,
  };
}
