import { getReviewClient, type ReviewClientResult } from "@/ai";
import type { AskAssumption } from "@/ai/context";
import { touchesIrreversibleAction } from "@/ai/manualReview";
import { buildReviewContext } from "@/ai/reviewContext";
import { validateReview } from "@/ai/reviewSchema";
import type { ReviewReport } from "@/ai/types";
import { decisionOutcomes, type DecisionThen } from "@/calc/decisionOutcome";
import {
  materialChange,
  snapshotSummary,
  type SnapshotSummary,
} from "@/calc/materialChange";
import { profile } from "@/calc/profile";
import { db } from "./db";
import { assumptions } from "./db/schema";
import { listDecisionsWithContext, saveDecision } from "./decisions";
import { getServerEnv } from "./env";
import { reviewNotification, sendNotification, type Notification } from "./notify";
import { latestReview, reviewForMonth, saveReview, type NewReview } from "./reviews";
import { latestStrategicSnapshot, storedSnapshotResult } from "./snapshots";

// The review orchestration — the scheduled monthly analyst. Mirrors
// ask.ts: every dependency injectable, the clock at the boundary, no throws to
// the caller. One deliberate difference from Ask: the review NEVER fails
// because the provider is unavailable. A missing key, a provider error or an
// answer that dies in validation all degrade the review to its deterministic
// floor (material change vs the last review + the tax-table version on
// record) — the month is always covered, honestly labelled with scope
// "deterministic" and the reason. Each published review sends one ntfy ping
// (coarse: scope + whether a recommendation was journaled, never figures).

export type ReviewRunResult =
  | { ok: true; skipped: true; month: string }
  | {
      ok: true;
      skipped: false;
      month: string;
      reviewId: string;
      scope: "full" | "deterministic";
      llmError: string | null;
      decisionId: string | null;
      droppedStatements: number;
      droppedFindings: number;
    }
  | { ok: false; reason: "no-snapshot" };

export type ReviewDeps = {
  apiKey: () => string | undefined;
  latestSnapshotRow: () => Promise<{ id: string; result: unknown } | null>;
  assumptionRows: () => Promise<AskAssumption[]>;
  reviewForMonth: (month: string) => Promise<{ id: string } | null>;
  previousReview: () => Promise<{ month: string; summary: unknown } | null>;
  // Every journaled decision with its pinned snapshot summary; the
  // accountability loop re-measures each one against the current snapshot.
  journaledDecisions: () => Promise<DecisionThen[]>;
  clientFor: (opts: { apiKey: string | undefined }) => ReviewClientResult;
  saveReview: (row: NewReview) => Promise<{ id: string }>;
  saveDecision: (row: {
    question: string;
    answer: unknown;
    context: unknown;
    assumptions: unknown;
    snapshotId: string;
    requiresManualReview: boolean;
    model: string;
  }) => Promise<{ id: string }>;
  notify: (n: Notification) => Promise<unknown>;
  today: () => string;
};

async function loadAssumptionRows(): Promise<AskAssumption[]> {
  const rows = await db.select().from(assumptions);
  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    value: row.value,
    dateValue: row.dateValue,
    source: row.source,
  }));
}

const defaultDeps: ReviewDeps = {
  apiKey: () => getServerEnv().OPENAI_API_KEY,
  latestSnapshotRow: () => latestStrategicSnapshot(),
  assumptionRows: loadAssumptionRows,
  reviewForMonth: (month) => reviewForMonth(month),
  previousReview: () => latestReview(),
  journaledDecisions: () => listDecisionsWithContext(),
  clientFor: getReviewClient,
  saveReview: (row) => saveReview(row),
  saveDecision: (row) => saveDecision(row),
  notify: (n) => sendNotification(n),
  today: () => new Date().toISOString().slice(0, 10),
};

export async function runMonthlyReview(
  deps: ReviewDeps = defaultDeps,
): Promise<ReviewRunResult> {
  const today = deps.today();
  const month = today.slice(0, 7);

  // One review per month — a cron re-fire or manual re-hit is a no-op.
  if (await deps.reviewForMonth(month)) return { ok: true, skipped: true, month };

  const row = await deps.latestSnapshotRow();
  if (!row) return { ok: false, reason: "no-snapshot" };
  const snapshot = storedSnapshotResult(row);

  // The deterministic floor: scenario re-evaluation vs the LAST REVIEW's
  // pinned summary (not the last strategic snapshot — the question here is
  // "did anything material change since I last reviewed?").
  const prev = await deps.previousReview();
  const mc = materialChange({
    snapshotId: snapshot.snapshotId,
    previous: (prev?.summary as SnapshotSummary | undefined) ?? null,
    current: snapshotSummary(snapshot),
  });

  const assumptionRows = await deps.assumptionRows();
  const birth = assumptionRows.find(
    (a) => a.key === "birthDate" && a.dateValue !== null,
  );
  const prof = profile({
    snapshotId: snapshot.snapshotId,
    asOf: today,
    birthDate: birth ? { id: birth.id, date: birth.dateValue as string } : null,
  });

  // The fired recommendation triggers: the ONLY thing that permits
  // a recommendation this month. Legacy stored snapshots carry none —
  // fail-closed, the review still runs. Pinned on the row so "no
  // triggers fired, nothing to recommend" is on the record, not an absence.
  const triggers = (snapshot.recommendationTriggers?.value.fired ?? []).map(
    (t) => ({ id: t.id, label: t.label }),
  );

  // The accountability loop: every journaled decision re-measured
  // against this snapshot — part of the deterministic floor, so the outcomes
  // land on the row even when the provider is unreachable.
  const outcomes = decisionOutcomes({
    snapshotId: snapshot.snapshotId,
    current: snapshotSummary(snapshot),
    decisions: await deps.journaledDecisions(),
  });

  const base: Omit<NewReview, "scope"> = {
    month,
    snapshotId: row.id,
    summary: snapshotSummary(snapshot),
    materialChange: mc.value,
    taxTableVersion: snapshot.taxES.version,
    outcomes,
    firedTriggers: triggers,
  };

  const deterministic = async (llmError: string): Promise<ReviewRunResult> => {
    const saved = await deps.saveReview({
      ...base,
      scope: "deterministic",
      llmError,
    });
    await deps.notify(
      reviewNotification({
        month,
        scope: "deterministic",
        llmError,
        hasRecommendation: false,
        requiresManualReview: false,
      }),
    );
    return {
      ok: true,
      skipped: false,
      month,
      reviewId: saved.id,
      scope: "deterministic",
      llmError,
      decisionId: null,
      droppedStatements: 0,
      droppedFindings: 0,
    };
  };

  // A missing key resolves before any context is assembled — the review's
  // web/LLM research is scoped away, the deterministic floor remains.
  const clientResult = deps.clientFor({ apiKey: deps.apiKey() });
  if (!clientResult.ok) return deterministic(clientResult.reason);

  const ctx = buildReviewContext({
    snapshot,
    profile: prof,
    assumptions: assumptionRows,
    month,
    materialChange: mc.value,
    previousReviewMonth: prev?.month ?? null,
    triggers,
    outcomes: outcomes.value.outcomes.length > 0 ? outcomes : null,
  });

  let outcome: { report: ReviewReport; model: string };
  try {
    outcome = await clientResult.client.review(ctx);
  } catch (err) {
    return deterministic(
      `provider-error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const validated = validateReview(outcome.report, ctx);
  if (!validated.ok) return deterministic(validated.reason);

  // A surviving recommendation is journaled as a Decision and gated exactly
  // like an Ask answer: the deterministic gate ORs over the model's flag.
  let decisionId: string | null = null;
  let recNeedsManualReview = false;
  const rec = validated.report.recommendation;
  if (rec) {
    const requiresManualReview =
      touchesIrreversibleAction(rec.text) || rec.requiresManualReview;
    recNeedsManualReview = requiresManualReview;
    const decision = await deps.saveDecision({
      question: `Monthly review ${month} — recommendation`,
      answer: {
        statements: [{ label: "judgment", text: rec.text, citations: [] }],
        suggestsReview: validated.report.suggestsReview,
        requiresManualReview,
      },
      context: ctx,
      assumptions: assumptionRows,
      snapshotId: row.id,
      requiresManualReview,
      model: outcome.model,
    });
    decisionId = decision.id;
  }

  const saved = await deps.saveReview({
    ...base,
    scope: "full",
    report: validated.report,
    context: ctx,
    model: outcome.model,
    decisionId,
  });

  await deps.notify(
    reviewNotification({
      month,
      scope: "full",
      llmError: null,
      hasRecommendation: decisionId !== null,
      requiresManualReview: recNeedsManualReview,
    }),
  );

  return {
    ok: true,
    skipped: false,
    month,
    reviewId: saved.id,
    scope: "full",
    llmError: null,
    decisionId,
    droppedStatements: validated.droppedStatements,
    droppedFindings: validated.droppedFindings,
  };
}
