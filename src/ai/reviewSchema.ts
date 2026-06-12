import { z } from "zod";
import { metricTokens, validateAnswer } from "./schema";
import type { AskContext, ReviewReport } from "./types";

// The review report's structured-output contract and its deterministic
// enforcement. Same posture as the Ask layer: the model is
// constrained by JSON schema, then validated again here, and everything that
// can't prove itself is dropped or weakened — never trusted.
//
// Two id spaces, two rules:
//  - the DIGEST and the RECOMMENDATION are about the USER → the Ask rules
//    apply verbatim (figures only via {{metric}} tokens, citations from the
//    context's id space, offenders dropped);
//  - FINDINGS and the TAX-TABLE verdict are about THE LAW → raw figures are
//    fine, but every claim needs an external web source URL or it goes.

const statementSchema = z
  .object({
    label: z.enum(["verified", "calculated", "judgment"]),
    text: z.string().min(1),
    citations: z.array(z.string()),
  })
  .strict();

export const reviewReportSchema = z
  .object({
    digest: z.array(statementSchema).min(1),
    // The analyst's read on the revisited decisions; same statement
    // rules as the digest, and forced empty when no decision is journaled.
    decisionsRevisited: z.array(statementSchema),
    findings: z.array(
      z
        .object({
          topic: z.string().min(1),
          summary: z.string().min(1),
          status: z.enum(["in-force", "announced"]),
          effectiveFrom: z.string().nullable(),
          sources: z.array(z.string()),
        })
        .strict(),
    ),
    taxTables: z
      .object({
        verdict: z.enum(["current", "drifted", "unverified"]),
        proposedVersion: z.string().nullable(),
        notes: z.string(),
        sources: z.array(z.string()),
      })
      .strict(),
    recommendation: z
      .object({
        text: z.string().min(1),
        requiresManualReview: z.boolean(),
      })
      .strict()
      .nullable(),
    suggestsReview: z.boolean(),
  })
  .strict();

export const reviewReportJsonSchema = z.toJSONSchema(reviewReportSchema);

const isWebSource = (url: string) => /^https?:\/\/\S+$/.test(url);

// A proposed bump must look like a versioned tax-table id — income (taxES) or
// wealth (taxIP); anything else is nulled (the proposal is
// advisory text either way — never applied).
const PROPOSED_VERSION = /^tax(ES|IP)\.[a-z-]+\.\d{4}(\.\d+)?$/;

export type ValidatedReview =
  | {
      ok: true;
      report: ReviewReport;
      droppedStatements: number;
      droppedFindings: number;
    }
  | { ok: false; reason: "empty-after-validation" };

export function validateReview(
  report: ReviewReport,
  ctx: Pick<AskContext, "metrics" | "allowedCitations"> & {
    // Fired recommendation triggers. Absent or empty ⇒ any
    // recommendation is dropped: no trigger, no recommendation — the model
    // can never originate one from browsing the portfolio. Fail-closed for
    // legacy stored snapshots, which carry no trigger calculator.
    triggers?: { id: string }[];
    // Revisited decisions. Absent or empty ⇒ the report's
    // decisionsRevisited is emptied: no journaled decision, no read on one.
    revisited?: { id: string }[];
  },
): ValidatedReview {
  // Digest: exactly the Ask validation, fail-closed when nothing survives.
  const digest = validateAnswer(
    { statements: report.digest, suggestsReview: false, requiresManualReview: false },
    ctx,
  );
  if (!digest.ok) return { ok: false, reason: "empty-after-validation" };

  // Decisions revisited: the Ask statement rules again, but drop-only — the
  // Calculated deltas are pinned on the review row deterministically, so a
  // read that dies in validation costs the voice, never the measurement. No
  // journaled decision ⇒ forced empty regardless of content.
  let revisitedStatements: ReviewReport["decisionsRevisited"] = [];
  let droppedRevisited = report.decisionsRevisited?.length ?? 0;
  if ((ctx.revisited ?? []).length > 0 && (report.decisionsRevisited ?? []).length > 0) {
    const validated = validateAnswer(
      {
        statements: report.decisionsRevisited,
        suggestsReview: false,
        requiresManualReview: false,
      },
      ctx,
    );
    if (validated.ok) {
      revisitedStatements = validated.answer.statements;
      droppedRevisited = validated.droppedStatements;
    }
  }

  // Findings: sourced or gone.
  const findings = report.findings
    .map((f) => ({ ...f, sources: f.sources.filter(isWebSource) }))
    .filter((f) => f.sources.length > 0);
  const droppedFindings = report.findings.length - findings.length;

  // Tax verdict: an unsourced "current"/"drifted" claim is weakened to
  // "unverified" (fail-closed — the claim gets weaker, never stronger), and a
  // malformed proposed version is nulled.
  const taxSources = report.taxTables.sources.filter(isWebSource);
  const proposedVersion =
    report.taxTables.proposedVersion !== null &&
    PROPOSED_VERSION.test(report.taxTables.proposedVersion)
      ? report.taxTables.proposedVersion
      : null;
  const taxTables: ReviewReport["taxTables"] = {
    verdict: taxSources.length === 0 ? "unverified" : report.taxTables.verdict,
    proposedVersion,
    notes: report.taxTables.notes,
    sources: taxSources,
  };

  // Recommendation: only PERMITTED when a deterministic trigger fired
  // — otherwise dropped regardless of content. Then the
  // no-raw-digits/token rule applies; a fabricating recommendation is
  // dropped, not repaired.
  let recommendation = report.recommendation;
  if (recommendation && (ctx.triggers ?? []).length === 0) {
    recommendation = null;
  }
  if (recommendation) {
    const metricIds = new Set(ctx.metrics.map((m) => m.id));
    const tokens = metricTokens(recommendation.text);
    const stripped = recommendation.text.replace(/\{\{[a-zA-Z0-9_.-]+\}\}/g, "");
    if (tokens.some((t) => !metricIds.has(t)) || /\d/.test(stripped)) {
      recommendation = null;
    }
  }

  return {
    ok: true,
    report: {
      digest: digest.answer.statements,
      decisionsRevisited: revisitedStatements,
      findings,
      taxTables,
      recommendation,
      suggestsReview: report.suggestsReview,
    },
    droppedStatements: digest.droppedStatements + droppedRevisited,
    droppedFindings,
  };
}
