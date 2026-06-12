import { describe, expect, it } from "vitest";
import { buildAskContext, type AskAssumption } from "@/ai/context";
import { computeSnapshot } from "@/calc/snapshot";
import { formatEUR } from "@/calc/money";
import { profile } from "@/calc/profile";
import { facts, fixture, FIXTURE_AS_OF } from "../fixtures";

// The "no raw account dump" boundary (invariant #6): the context the model
// sees carries calculator summaries and assumption summaries only — never
// account/holding/movement/price ids, never the CalcResult inputs[] lists.

const snapshot = computeSnapshot({
  snapshotId: "snap_test",
  asOf: FIXTURE_AS_OF,
  reviewDue: false,
  facts,
});

const assumptions: AskAssumption[] = fixture.assumptions.map((a) => ({
  id: a.id,
  key: a.key,
  value: a.value,
  dateValue: a.dateValue ?? null,
  source: a.source,
}));

const prof = profile({
  snapshotId: "snap_test",
  asOf: FIXTURE_AS_OF,
  birthDate: { id: "assum_birth", date: "1988-07-14" },
});

const ctx = buildAskContext({
  snapshot,
  profile: prof,
  assumptions,
  question: "How is my runway?",
  gateFired: false,
});

describe("buildAskContext", () => {
  it("contains the calculator figures, provenance and profile age", () => {
    expect(ctx.input).toContain("snap_test");
    expect(ctx.input).toContain(formatEUR(snapshot.netWorth.value.totalEUR));
    expect(ctx.input).toContain("netWorth.v1");
    expect(ctx.input).toContain(snapshot.netWorth.version);
    expect(ctx.input).toContain('"ageYears":37'); // 1988-07-14 at 2026-06-09
    expect(ctx.input).toContain("How is my runway?");
    expect(ctx.metrics.find((m) => m.id === "fire.runwayMonths")?.value).toBe(
      `${snapshot.fire.value.runwayMonths} months`,
    );
  });

  it("never leaks raw account/holding/movement/price ids or inputs[] lists", () => {
    const rawIds = [
      ...fixture.accounts.map((a) => a.id),
      ...fixture.holdings.map((h) => h.id),
      ...fixture.movements.map((m) => m.id),
      ...fixture.prices.map((p) => p.id),
      ...fixture.properties.map((p) => p.id),
      ...(fixture.taxLots ?? []).map((l) => l.id),
      ...snapshot.netWorth.inputs,
      ...snapshot.fire.inputs.filter((id) => !id.startsWith("assum_")),
    ];
    for (const id of rawIds) expect(ctx.input).not.toContain(id);
    expect(ctx.input).not.toContain('"inputs"');
  });

  it("whitelists exactly the snapshot, calc sources, profile and assumption ids", () => {
    expect([...ctx.allowedCitations].sort()).toEqual(
      [
        "snap_test",
        "netWorth.v1",
        "fire.v2",
        "taxES.v1",
        "dataQuality.v1",
        "status.v1",
        "profile.v1",
        "scenario.v1",
        ...assumptions.map((a) => a.id),
      ].sort(),
    );
    for (const id of ctx.allowedCitations) {
      expect(ctx.citationLabels[id]).toBeTruthy();
    }
  });

  it("exposes scenario diffs as positional metric tokens without leaking fact ids", () => {
    // The fixture snapshot carries 6 standard scenarios (3 properties + 3
    // positions); their keys embed fact ids, so the metric ids are positional.
    const deltaMetric = ctx.metrics.find(
      (m) => m.id === "scenario.1.netWorthDeltaEUR",
    );
    expect(deltaMetric).toBeTruthy();
    expect(deltaMetric!.citations).toContain("scenario.v1");
    const input = JSON.parse(ctx.input) as {
      scenarios: { id: string; label: string; irreversible: boolean }[];
    };
    expect(input.scenarios).toHaveLength(snapshot.scenarios!.length);
    expect(input.scenarios[0].id).toBe("scenario.1");
    expect(input.scenarios.some((s) => s.irreversible)).toBe(true);
    expect(ctx.input).not.toContain("sell-property:"); // raw keys stay out
    expect(ctx.instructions).toContain("scenario.");
  });

  it("labels a basis-incomplete scenario's Δ as an upper bound (scenario.es.2026.7)", () => {
    const noBasis = computeSnapshot({
      snapshotId: "snap_nobasis",
      asOf: FIXTURE_AS_OF,
      reviewDue: false,
      facts: {
        ...facts,
        properties: facts.properties.map((p) =>
          p.id === "prop_rent_a" ? { ...p, purchasePrice: null } : p,
        ),
      },
    });
    const noBasisCtx = buildAskContext({
      snapshot: noBasis,
      profile: prof,
      assumptions,
      question: "Should I sell the rental?",
      gateFired: true,
    });
    const upperBound = noBasisCtx.metrics.filter(
      (m) =>
        m.id.endsWith(".netWorthDeltaEUR") && m.label.includes("upper bound"),
    );
    expect(upperBound).toHaveLength(1);
    // Basis-complete scenarios keep their plain label.
    expect(
      ctx.metrics.some(
        (m) =>
          m.id.endsWith(".netWorthDeltaEUR") && m.label.includes("upper bound"),
      ),
    ).toBe(false);
  });

  it("cites the assumption rows on the fire.v2 real-view metrics", () => {
    // Assumption-driven figures carry the assumption rows as citations —
    // calculator source alone is not the full provenance there.
    const realRunway = ctx.metrics.find((m) => m.id === "fire.realRunwayYears");
    const realReturn = ctx.metrics.find((m) => m.id === "fire.realReturnAnnual");
    for (const m of [realRunway, realReturn]) {
      expect(m).toBeTruthy();
      expect(m!.citations).toContain("assum_return");
      expect(m!.citations).toContain("assum_lri");
      expect(m!.citations).toContain("fire.v2");
    }
    // The non-assumption-driven withdrawal ratio cites the calculator only.
    const actual = ctx.metrics.find((m) => m.id === "fire.actualWithdrawalRate");
    expect(actual!.value).toBe("11.02%"); // 3200·12 / 348520 fireCounted
    expect(actual!.citations).not.toContain("assum_return");
  });

  it("drops the real-view tokens when the assumptions are missing", () => {
    const without = computeSnapshot({
      snapshotId: "snap_test2",
      asOf: FIXTURE_AS_OF,
      reviewDue: false,
      facts: {
        ...facts,
        assumptions: facts.assumptions.filter(
          (a) => a.key !== "longRunInflation",
        ),
      },
    });
    const ctx2 = buildAskContext({
      snapshot: without,
      profile: prof,
      assumptions: assumptions.filter((a) => a.key !== "longRunInflation"),
      question: "How is my runway?",
      gateFired: false,
    });
    expect(ctx2.metrics.find((m) => m.id === "fire.realRunwayYears")).toBeUndefined();
    expect(ctx2.metrics.find((m) => m.id === "fire.realReturnAnnual")).toBeUndefined();
  });

  it("exposes the sell-property yield tokens with assumption citations", () => {
    const yieldMetrics = ctx.metrics.filter((m) =>
      /^scenario\.\d+\.(realNetYieldPct|etfRealReturnPct|realYieldGapPct)$/.test(
        m.id,
      ),
    );
    // 3 sell-property scenarios in the fixture, 3 tokens each.
    expect(yieldMetrics.length).toBe(9);
    for (const m of yieldMetrics) {
      expect(m.citations).toContain("assum_return");
      expect(m.citations).toContain("assum_lri");
      expect(m.citations).toContain("scenario.v1");
    }
    const etf = yieldMetrics.find((m) => m.id.endsWith("etfRealReturnPct"));
    expect(etf!.label).toContain("your assumption");
  });

  it("exposes the grown spread delta with the expectedReturn citation", () => {
    const grownDeltas = ctx.metrics.filter((m) =>
      m.id.endsWith(".spreadTaxDeltaGrownEUR"),
    );
    expect(grownDeltas.length).toBeGreaterThan(0);
    for (const m of grownDeltas) {
      expect(m.citations).toContain("assum_return");
      expect(m.label).toContain("negative = spreading costs more");
    }
  });

  it("appends the gate note only when the deterministic gate fired", () => {
    const gated = buildAskContext({
      snapshot,
      profile: prof,
      assumptions,
      question: "Should I sell the flat?",
      gateFired: true,
    });
    expect(gated.instructions).toContain("irreversible action");
    expect(ctx.instructions).not.toContain("already locked");
  });
});
