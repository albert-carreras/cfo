import { describe, expect, it } from "vitest";
import { getReviewClient } from "@/ai";
import { createFakeReviewClient } from "@/ai/fake";
import type { AskAnswer, ReviewContext, ReviewReport } from "@/ai/types";
import type { DecisionOutcomesValue } from "@/calc/decisionOutcome";
import { dec } from "@/calc/money";
import { computeSnapshot } from "@/calc/snapshot";
import type { CalcResult } from "@/calc/types";
import type { Notification } from "@/server/notify";
import type { NewReview } from "@/server/reviews";
import { runMonthlyReview, type ReviewDeps } from "@/server/review";
import { facts, fixture, FIXTURE_AS_OF } from "../fixtures";

// The review orchestration seam, end to end with no DB and no network. The
// load-bearing property: the monthly cadence NEVER depends on the provider —
// a missing key, provider throws and validation failures all land a
// deterministic-scope review row, honestly labelled with the reason.

const snapshot = computeSnapshot({
  snapshotId: "snap_rev",
  asOf: FIXTURE_AS_OF,
  reviewDue: false,
  facts,
});

type SavedDecision = Parameters<ReviewDeps["saveDecision"]>[0];

function makeDeps(overrides: Partial<ReviewDeps> = {}) {
  const savedReviews: NewReview[] = [];
  const savedDecisions: SavedDecision[] = [];
  const notified: Notification[] = [];
  const deps: ReviewDeps = {
    apiKey: () => "sk-test",
    latestSnapshotRow: async () => ({ id: "snap_rev", result: snapshot }),
    assumptionRows: async () =>
      fixture.assumptions.map((a) => ({
        id: a.id,
        key: a.key,
        value: a.value,
        dateValue: a.dateValue ?? null,
        source: a.source,
      })),
    reviewForMonth: async () => null,
    previousReview: async () => null,
    journaledDecisions: async () => [],
    clientFor: () => ({ ok: true, client: createFakeReviewClient() }),
    saveReview: async (row) => {
      savedReviews.push(row);
      return { id: "rev_1" };
    },
    saveDecision: async (row) => {
      savedDecisions.push(row);
      return { id: "dec_1" };
    },
    notify: async (n) => {
      notified.push(n);
    },
    today: () => "2026-06-10",
    ...overrides,
  };
  return { deps, savedReviews, savedDecisions, notified };
}

describe("runMonthlyReview", () => {
  it("runs a full review: validates, persists, no decision when no recommendation", async () => {
    const { deps, savedReviews, savedDecisions } = makeDeps();
    const result = await runMonthlyReview(deps);

    expect(result).toMatchObject({
      ok: true,
      skipped: false,
      month: "2026-06",
      scope: "full",
      llmError: null,
      decisionId: null,
    });
    expect(savedDecisions).toHaveLength(0);
    expect(savedReviews).toHaveLength(1);
    const row = savedReviews[0];
    expect(row.month).toBe("2026-06");
    expect(row.scope).toBe("full");
    expect(row.snapshotId).toBe("snap_rev");
    expect(row.taxTableVersion).toBe(snapshot.taxES.version);
    expect(row.model).toBe("fake");
    // First review ⇒ material (first_snapshot) — the next one compares to this summary.
    expect(row.materialChange).toMatchObject({ material: true });
    expect((row.report as ReviewReport).digest.length).toBeGreaterThan(0);
  });

  it("is a no-op when the month already has a review", async () => {
    const { deps, savedReviews } = makeDeps({
      reviewForMonth: async () => ({ id: "rev_existing" }),
    });
    expect(await runMonthlyReview(deps)).toEqual({
      ok: true,
      skipped: true,
      month: "2026-06",
    });
    expect(savedReviews).toHaveLength(0);
  });

  it("compares against the PREVIOUS REVIEW's summary, not the latest strategic snapshot", async () => {
    const { deps, savedReviews } = makeDeps({
      previousReview: async () => ({
        month: "2026-05",
        summary: {
          asOf: "2026-05-01",
          totalNetWorthEUR: snapshot.netWorth.value.totalEUR,
          runwayMonths: snapshot.fire.value.runwayMonths,
          status: snapshot.status.value.status,
        },
      }),
    });
    await runMonthlyReview(deps);
    expect(savedReviews[0].materialChange).toMatchObject({
      material: false,
      comparedTo: "2026-05-01",
    });
  });

  it("a missing key degrades to a deterministic review via the real factory", async () => {
    const { deps, savedReviews } = makeDeps({
      apiKey: () => undefined,
      clientFor: getReviewClient, // the real factory: the key gate resolves first
    });
    expect(await runMonthlyReview(deps)).toMatchObject({
      ok: true,
      scope: "deterministic",
      llmError: "no-key",
    });
    expect(savedReviews[0]).toMatchObject({ scope: "deterministic", llmError: "no-key" });
    expect(savedReviews[0].report).toBeUndefined();
  });

  it("a provider throw still writes the month's review, deterministically", async () => {
    const { deps, savedReviews } = makeDeps({
      clientFor: () => ({
        ok: true,
        client: {
          review: async () => {
            throw new Error("boom");
          },
        },
      }),
    });
    const result = await runMonthlyReview(deps);
    expect(result).toMatchObject({ ok: true, scope: "deterministic" });
    expect(savedReviews[0].llmError).toContain("provider-error: boom");
  });

  it("a report that dies in validation degrades instead of journaling garbage", async () => {
    const fabricator = createFakeReviewClient({
      digest: [{ label: "calculated", text: "Net worth is 1234.", citations: [] }],
      decisionsRevisited: [],
      findings: [],
      taxTables: { verdict: "unverified", proposedVersion: null, notes: "", sources: [] },
      recommendation: null,
      suggestsReview: false,
    });
    const { deps, savedReviews } = makeDeps({
      clientFor: () => ({ ok: true, client: fabricator }),
    });
    const result = await runMonthlyReview(deps);
    expect(result).toMatchObject({
      ok: true,
      scope: "deterministic",
      llmError: "empty-after-validation",
    });
    expect(savedReviews[0].report).toBeUndefined();
  });

  it("journals a recommendation as a gated decision — the deterministic gate ORs over the model's flag", async () => {
    const recommender = createFakeReviewClient({
      digest: [{ label: "judgment", text: "All calm.", citations: [] }],
      decisionsRevisited: [],
      findings: [],
      taxTables: { verdict: "unverified", proposedVersion: null, notes: "", sources: [] },
      // The model says no review needed — but the text touches a sale.
      recommendation: { text: "Consider selling the apartment.", requiresManualReview: false },
      suggestsReview: true,
    });
    const { deps, savedReviews, savedDecisions } = makeDeps({
      clientFor: () => ({ ok: true, client: recommender }),
    });
    const result = await runMonthlyReview(deps);
    expect(result).toMatchObject({ ok: true, scope: "full", decisionId: "dec_1" });

    expect(savedDecisions).toHaveLength(1);
    const decision = savedDecisions[0];
    expect(decision.question).toBe("Monthly review 2026-06 — recommendation");
    expect(decision.requiresManualReview).toBe(true);
    expect(decision.snapshotId).toBe("snap_rev");
    expect((decision.answer as AskAnswer).requiresManualReview).toBe(true);
    expect(savedReviews[0].decisionId).toBe("dec_1");
  });

  it("every published review sends one coarse ping; a skipped month sends none", async () => {
    const { deps, notified } = makeDeps();
    await runMonthlyReview(deps);
    expect(notified).toHaveLength(1);
    expect(notified[0].title).toBe("CFO: 2026-06 review published");
    expect(notified[0].message).toContain("full scope");
    // Coarse payload discipline: never a € amount.
    expect(notified[0].message).not.toMatch(/€|\d{4,}/);

    const skipped = makeDeps({ reviewForMonth: async () => ({ id: "rev_existing" }) });
    await runMonthlyReview(skipped.deps);
    expect(skipped.notified).toHaveLength(0);

    const degraded = makeDeps({ apiKey: () => undefined, clientFor: getReviewClient });
    await runMonthlyReview(degraded.deps);
    expect(degraded.notified[0].message).toContain("deterministic floor (no-key)");
  });

  it("pins the fired triggers and an empty outcomes record on every row", async () => {
    const { deps, savedReviews } = makeDeps();
    await runMonthlyReview(deps);
    const row = savedReviews[0];
    // No triggers fired ⇒ informative silence, on the record.
    expect(row.firedTriggers).toEqual(
      (snapshot.recommendationTriggers?.value.fired ?? []).map((t) => ({
        id: t.id,
        label: t.label,
      })),
    );
    expect(row.outcomes).toMatchObject({
      source: "decisionOutcome.v1",
      value: { outcomes: [] },
    });
  });

  it("a month-N recommendation shows its measured outcome in month N+1 — even on the deterministic floor", async () => {
    // The decision journaled by last month's review, pinned to a summary with
    // different numbers than today's snapshot.
    const { deps, savedReviews } = makeDeps({
      apiKey: () => undefined, // exit criterion: deterministic floor only
      clientFor: getReviewClient,
      journaledDecisions: async () => [
        {
          id: "dec_may",
          question: "Monthly review 2026-05 — recommendation",
          decidedOn: "2026-05-01",
          reviewed: true,
          chosenAction: "trimmed the sector ETF",
          then: {
            asOf: "2026-05-01",
            totalNetWorthEUR: dec(snapshot.netWorth.value.totalEUR)
              .minus(10000)
              .toFixed(2),
            runwayMonths: snapshot.fire.value.runwayMonths,
            status: "stable",
          },
        },
      ],
    });
    const result = await runMonthlyReview(deps);
    expect(result).toMatchObject({ ok: true, scope: "deterministic" });

    const stored = savedReviews[0].outcomes as CalcResult<DecisionOutcomesValue>;
    expect(stored.inputs).toEqual(["dec_may"]);
    expect(stored.value.outcomes).toHaveLength(1);
    expect(stored.value.outcomes[0]).toMatchObject({
      decisionId: "dec_may",
      chosenAction: "trimmed the sector ETF",
      netWorthDeltaEUR: "10000.00",
      statusThen: "stable",
      statusNow: snapshot.status.value.status,
    });
  });

  it("a full review's context carries the revisited decisions so the analyst can read them", async () => {
    const { deps, savedReviews } = makeDeps({
      journaledDecisions: async () => [
        {
          id: "dec_may",
          question: "Monthly review 2026-05 — recommendation",
          decidedOn: "2026-05-01",
          reviewed: false,
          chosenAction: null,
          then: {
            asOf: "2026-05-01",
            totalNetWorthEUR: snapshot.netWorth.value.totalEUR,
            runwayMonths: snapshot.fire.value.runwayMonths,
            status: snapshot.status.value.status,
          },
        },
      ],
    });
    const result = await runMonthlyReview(deps);
    expect(result).toMatchObject({ ok: true, scope: "full" });

    const ctx = savedReviews[0].context as ReviewContext;
    expect(ctx.revisited).toEqual([{ id: "decision.1" }]);
    // The fake client references a decision.N metric; it survives validation.
    const report = savedReviews[0].report as ReviewReport;
    expect(report.decisionsRevisited.length).toBeGreaterThan(0);
    expect(report.decisionsRevisited[0].text).toContain("{{decision.1.");
  });

  it("fails only when there is no snapshot to review", async () => {
    const { deps, savedReviews } = makeDeps({ latestSnapshotRow: async () => null });
    expect(await runMonthlyReview(deps)).toEqual({ ok: false, reason: "no-snapshot" });
    expect(savedReviews).toHaveLength(0);
  });
});
