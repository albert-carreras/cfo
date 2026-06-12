import { describe, expect, it } from "vitest";
import { createFakeReviewClient } from "@/ai/fake";
import { buildReviewContext } from "@/ai/reviewContext";
import { validateReview } from "@/ai/reviewSchema";
import type { ReviewReport } from "@/ai/types";
import { decisionOutcomes } from "@/calc/decisionOutcome";
import { snapshotSummary } from "@/calc/materialChange";
import { computeSnapshot } from "@/calc/snapshot";
import { facts, FIXTURE_AS_OF } from "../fixtures";

// The review report's deterministic enforcement: user-facing parts obey the
// Ask rules (tokens, citations, no raw digits), law-facing parts must be
// web-sourced or they weaken/disappear. Nothing is ever repaired upward.

const snapshot = computeSnapshot({
  snapshotId: "snap_rev",
  asOf: FIXTURE_AS_OF,
  reviewDue: false,
  facts,
});

// One journaled decision re-measured — exposes decision.1.* metrics
// and the review.decisionsRevisited brief entries.
const outcomes = decisionOutcomes({
  snapshotId: "snap_rev",
  current: snapshotSummary(snapshot),
  decisions: [
    {
      id: "dec_a",
      question: "Monthly review 2026-05 — recommendation",
      decidedOn: "2026-05-01",
      reviewed: false,
      chosenAction: null,
      then: {
        asOf: "2026-05-01",
        totalNetWorthEUR: "100000.00",
        runwayMonths: 40,
        status: "stable",
      },
    },
  ],
});

const ctx = buildReviewContext({
  snapshot,
  profile: null,
  assumptions: [],
  month: "2026-06",
  materialChange: {
    material: false,
    changes: [],
    netWorthDeltaPct: null,
    comparedTo: null,
  },
  previousReviewMonth: null,
  // A fired trigger PERMITS a recommendation — the no-trigger
  // gating has its own tests below.
  triggers: [{ id: "overspend", label: "Spend assumption exceeds safe spend" }],
  outcomes,
});

const metricId = ctx.metrics[0].id;

function report(overrides: Partial<ReviewReport> = {}): ReviewReport {
  return {
    digest: [
      {
        label: "calculated",
        text: `Net worth stands at {{${metricId}}}.`,
        citations: ctx.metrics[0].citations,
      },
    ],
    decisionsRevisited: [],
    findings: [],
    taxTables: {
      verdict: "current",
      proposedVersion: null,
      notes: "",
      sources: ["https://www.boe.es/example"],
    },
    recommendation: null,
    suggestsReview: false,
    ...overrides,
  };
}

describe("buildReviewContext", () => {
  it("carries the review brief and the review-only facts on top of the ask context", () => {
    expect(ctx.month).toBe("2026-06");
    expect(ctx.instructions).toContain("regulatory watch");
    const input = JSON.parse(ctx.input);
    expect(input.review.taxTables.version).toBe(snapshot.taxES.version);
    expect(input.review.materialChange.material).toBe(false);
    expect(input.review.previousReviewMonth).toBeNull();
    // The no-raw-dump boundary is inherited from buildAskContext.
    expect(ctx.input).not.toContain('"movements"');
    expect(ctx.allowedCitations).toContain("snap_rev");
  });

  it("exposes revisited decisions as positional decision.N metrics and brief entries", () => {
    const input = JSON.parse(ctx.input);
    expect(input.review.decisionsRevisited).toHaveLength(1);
    expect(input.review.decisionsRevisited[0]).toMatchObject({
      id: "decision.1",
      question: "Monthly review 2026-05 — recommendation",
      decidedOn: "2026-05-01",
      statusThen: "stable",
      reviewed: false,
    });
    // The raw decision id never crosses the boundary — positional ids only.
    expect(ctx.input).not.toContain("dec_a");

    const deltaMetric = ctx.metrics.find(
      (m) => m.id === "decision.1.netWorthDeltaEUR",
    );
    expect(deltaMetric).toBeDefined();
    expect(deltaMetric!.citations).toContain("decisionOutcome.v1");
    // The appended metrics are visible in the serialized input too.
    expect(
      (input.metrics as { id: string }[]).some(
        (m) => m.id === "decision.1.netWorthDeltaEUR",
      ),
    ).toBe(true);
    expect(ctx.allowedCitations).toContain("decisionOutcome.v1");
    expect(ctx.revisited).toEqual([{ id: "decision.1" }]);
  });
});

describe("validateReview", () => {
  it("passes a clean report through unchanged", () => {
    const result = validateReview(report(), ctx);
    expect(result).toMatchObject({ ok: true, droppedStatements: 0, droppedFindings: 0 });
  });

  it("drops digest statements with raw digits and fails closed when none survive", () => {
    const fabricated = report({
      digest: [
        { label: "calculated", text: "Your runway is 999 months.", citations: [] },
      ],
    });
    expect(validateReview(fabricated, ctx)).toEqual({
      ok: false,
      reason: "empty-after-validation",
    });
  });

  it("counts dropped digest statements while keeping the valid ones", () => {
    const mixed = report({
      digest: [
        ...report().digest,
        { label: "calculated", text: "You have 42 accounts.", citations: [] },
      ],
    });
    const result = validateReview(mixed, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.digest).toHaveLength(1);
      expect(result.droppedStatements).toBe(1);
    }
  });

  it("drops findings without a web source and strips non-URL sources", () => {
    const result = validateReview(
      report({
        findings: [
          {
            topic: "IRPF savings bands",
            summary: "Top savings rate rises to 30% above €300,000.",
            status: "announced",
            effectiveFrom: "2027-01-01",
            sources: ["https://www.boe.es/x", "hearsay"],
          },
          {
            topic: "Unsourced rumor",
            summary: "Something changed.",
            status: "in-force",
            effectiveFrom: null,
            sources: ["not a url"],
          },
        ],
      }),
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.findings).toHaveLength(1);
      expect(result.report.findings[0].sources).toEqual(["https://www.boe.es/x"]);
      expect(result.droppedFindings).toBe(1);
    }
  });

  it("weakens an unsourced tax verdict to unverified and nulls a malformed proposed version", () => {
    const result = validateReview(
      report({
        taxTables: {
          verdict: "drifted",
          proposedVersion: "definitely-not-a-version",
          notes: "Bands changed.",
          sources: [],
        },
      }),
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.taxTables.verdict).toBe("unverified");
      expect(result.report.taxTables.proposedVersion).toBeNull();
    }
  });

  it("accepts a wealth-tax (taxIP) bump proposal", () => {
    const result = validateReview(
      report({
        taxTables: {
          verdict: "drifted",
          proposedVersion: "taxIP.es-cat.2027.1",
          notes: "IP scale changed.",
          sources: ["https://www.boe.es/diario_boe/"],
        },
      }),
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.taxTables.proposedVersion).toBe("taxIP.es-cat.2027.1");
    }
  });

  it("keeps a sourced drift verdict with a well-formed proposed version", () => {
    const result = validateReview(
      report({
        taxTables: {
          verdict: "drifted",
          proposedVersion: "taxES.es-cat.2027.1",
          notes: "State savings scale changed.",
          sources: ["https://www.boe.es/diario_boe/"],
        },
      }),
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.taxTables.verdict).toBe("drifted");
      expect(result.report.taxTables.proposedVersion).toBe("taxES.es-cat.2027.1");
    }
  });

  it("drops a recommendation that types digits about the user", () => {
    const result = validateReview(
      report({
        recommendation: {
          text: "Consider selling €50,000 of the position.",
          requiresManualReview: true,
        },
      }),
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.report.recommendation).toBeNull();
  });

  it("drops any recommendation when no deterministic trigger fired — no trigger, no recommendation", () => {
    const noTriggers = { ...ctx, triggers: [] };
    const result = validateReview(
      report({
        recommendation: {
          text: "Consider rebalancing toward bonds.",
          requiresManualReview: false,
        },
      }),
      noTriggers,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.report.recommendation).toBeNull();
    // Fail-closed for legacy stored snapshots, where triggers are absent.
    const legacy = validateReview(
      report({
        recommendation: { text: "Do something.", requiresManualReview: false },
      }),
      { metrics: ctx.metrics, allowedCitations: ctx.allowedCitations },
    );
    expect(legacy.ok).toBe(true);
    if (legacy.ok) expect(legacy.report.recommendation).toBeNull();
  });

  it("lists the fired triggers in the review brief", () => {
    const input = JSON.parse(ctx.input);
    expect(input.review.triggers).toEqual([
      { id: "overspend", label: "Spend assumption exceeds safe spend" },
    ]);
    expect(ctx.instructions).toContain("review.triggers");
  });

  it("keeps a token-only recommendation", () => {
    const result = validateReview(
      report({
        recommendation: {
          text: `With runway at {{fire.runwayMonths}}, consider revisiting the plan.`,
          requiresManualReview: false,
        },
      }),
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.report.recommendation).not.toBeNull();
  });

  it("keeps a token-only decisionsRevisited read and drops a fabricating one", () => {
    const result = validateReview(
      report({
        decisionsRevisited: [
          {
            label: "judgment",
            text: "Since that recommendation the move has been {{decision.1.netWorthDeltaEUR}} — mostly the market.",
            citations: [],
          },
          {
            label: "judgment",
            text: "That decision earned you 50000 euros.",
            citations: [],
          },
        ],
      }),
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.decisionsRevisited).toHaveLength(1);
      expect(result.droppedStatements).toBe(1);
    }
  });

  it("forces decisionsRevisited empty when no decision is journaled — no decision, no read", () => {
    const phantom = report({
      decisionsRevisited: [
        { label: "judgment", text: "Your past decisions look wise.", citations: [] },
      ],
    });
    const noRevisited = validateReview(phantom, { ...ctx, revisited: [] });
    expect(noRevisited.ok).toBe(true);
    if (noRevisited.ok) {
      expect(noRevisited.report.decisionsRevisited).toEqual([]);
      expect(noRevisited.droppedStatements).toBe(1);
    }
    // Fail-closed for contexts that predate the accountability loop (no revisited field).
    const legacy = validateReview(phantom, {
      metrics: ctx.metrics,
      allowedCitations: ctx.allowedCitations,
    });
    expect(legacy.ok).toBe(true);
    if (legacy.ok) expect(legacy.report.decisionsRevisited).toEqual([]);
  });

  it("a decisionsRevisited that dies entirely never fails the review — drop-only, the deltas are pinned elsewhere", () => {
    const result = validateReview(
      report({
        decisionsRevisited: [
          { label: "judgment", text: "Up 12% since!", citations: [] },
        ],
      }),
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.report.decisionsRevisited).toEqual([]);
  });

  it("the fake review client's report passes the same validation as a real provider", async () => {
    const { report: fakeReport } = await createFakeReviewClient().review(ctx);
    expect(validateReview(fakeReport, ctx)).toMatchObject({
      ok: true,
      droppedStatements: 0,
      droppedFindings: 0,
    });
  });
});
