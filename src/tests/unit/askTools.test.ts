import { describe, expect, it } from "vitest";
import { buildAskContext } from "@/ai/context";
import { validateAnswer } from "@/ai/schema";
import { formatEUR } from "@/calc/money";
import { computeSnapshot } from "@/calc/snapshot";
import { buildAskTooling } from "@/server/askTools";
import type { FactsBundle } from "@/server/facts";
import { facts, FIXTURE_AS_OF } from "../fixtures";

// The Ask tools: deterministic executors that turn a hypothetical into
// registered {{metric-id}} tokens on the shared context. The figures here are
// the buy-house scenario's own tested numbers — the tool must only relabel
// and register them, never change them.

const snapshot = computeSnapshot({
  snapshotId: "snap_tools",
  asOf: FIXTURE_AS_OF,
  reviewDue: false,
  facts,
});

const bundle: FactsBundle = {
  facts,
  accountNameById: {},
  holdingNameById: { hold_vwce: "VWCE", hold_smh: "SMH", hold_aggh: "AGGH" },
  propertyNameById: {
    prop_home: "Home",
    prop_rent_a: "Rental A",
    prop_rent_b: "Rental B",
  },
  sourceLabelById: {},
};

const vwceScenarioId = `scenario.${
  snapshot.scenarios!.findIndex((s) => s.value.key === "sell-position:hold_vwce") + 1
}`;
const rentalAScenarioId = `scenario.${
  snapshot.scenarios!.findIndex((s) => s.value.key === "sell-property:prop_rent_a") + 1
}`;

function freshContext() {
  const ctx = buildAskContext({
    snapshot,
    profile: null,
    assumptions: [],
    question: "Should I buy a house for 400k?",
    gateFired: true,
  });
  const tooling = buildAskTooling({
    ctx,
    snapshot,
    bundle,
    asOf: FIXTURE_AS_OF,
  });
  return { ctx, tooling };
}

describe("buildAskTooling — buy_house_scenario", () => {
  it("registers the scenario's figures as metric tokens on the shared context", async () => {
    const { ctx, tooling } = freshContext();
    const before = ctx.metrics.length;
    const result = await tooling.execute("buy_house_scenario", {
      priceEUR: 400000,
      fundBySellingScenarioIds: [vwceScenarioId],
    });
    expect(result.ok).toBe(true);
    expect(ctx.metrics.length).toBeGreaterThan(before);
    const byId = Object.fromEntries(ctx.metrics.map((m) => [m.id, m.value]));
    // The buy-house test's hand-checked figures, relabelled as tokens.
    expect(byId["tool.1.itpEUR"]).toBe(formatEUR("40000.00"));
    expect(byId["tool.1.upfrontCashEUR"]).toBe(formatEUR("126000.00"));
    expect(byId["tool.1.monthlyPaymentEUR"]).toBe(formatEUR("1517.48"));
    expect(byId["tool.1.fundingCgTaxEUR"]).toBe(formatEUR("8182.34"));
    // The model's view carries the same ids so it can token-reference them.
    if (result.ok) {
      const output = result.output as { scenarios: { id: string; exclusions: string[] }[] };
      expect(output.scenarios[0].id).toBe("tool.1");
      expect(output.scenarios[0].exclusions.length).toBeGreaterThan(0);
    }
  });

  it("keeps validation closed: tool tokens validate, invented digits still drop", async () => {
    const { ctx, tooling } = freshContext();
    await tooling.execute("buy_house_scenario", { priceEUR: 400000 });
    const validated = validateAnswer(
      {
        statements: [
          {
            label: "calculated",
            text: "The monthly payment would be {{tool.1.monthlyPaymentEUR}}.",
            citations: [],
          },
          {
            label: "calculated",
            text: "The payment would be about 1500 euros.",
            citations: [],
          },
        ],
        suggestsReview: false,
        requiresManualReview: true,
      },
      ctx,
    );
    expect(validated.ok).toBe(true);
    if (validated.ok) {
      // The digit statement dropped; the token statement survived with the
      // tool's citations merged in.
      expect(validated.answer.statements).toHaveLength(1);
      expect(validated.droppedStatements).toBe(1);
      expect(validated.answer.statements[0].citations).toContain("mortgage.v1");
      expect(validated.answer.statements[0].citations).toContain("scenario.v1");
    }
  });

  it("sweeps down-payment variants in one call with sequential token prefixes", async () => {
    const { ctx, tooling } = freshContext();
    const result = await tooling.execute("buy_house_scenario", {
      priceEUR: 400000,
      downPaymentPct: 20,
      downPaymentPctVariants: [30, 40],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = result.output as { scenarios: { id: string }[] };
      expect(output.scenarios.map((s) => s.id)).toEqual([
        "tool.1",
        "tool.2",
        "tool.3",
      ]);
    }
    // Higher down payment ⇒ lower payment, monotonic across the sweep.
    const byId = Object.fromEntries(ctx.metrics.map((m) => [m.id, m.value]));
    expect(byId["tool.1.mortgagePrincipalEUR"]).toBe(formatEUR("320000.00"));
    expect(byId["tool.3.mortgagePrincipalEUR"]).toBe(formatEUR("240000.00"));
  });

  it("chains a property sale referenced by its positional scenario id", async () => {
    const { ctx, tooling } = freshContext();
    const result = await tooling.execute("buy_house_scenario", {
      priceEUR: 400000,
      sellPropertyScenarioId: rentalAScenarioId,
    });
    expect(result.ok).toBe(true);
    const byId = Object.fromEntries(ctx.metrics.map((m) => [m.id, m.value]));
    // ITP 40,000 + rental A's sale taxes 5,340 (the buy-house test's figure).
    expect(byId["tool.1.oneOffTaxEUR"]).toBe(formatEUR("45340.00"));
  });

  it("rejects wrong-kind or unknown scenario references and unknown tools", async () => {
    const { tooling } = freshContext();
    // A sell-position id where a sell-property is required.
    const wrongKind = await tooling.execute("buy_house_scenario", {
      priceEUR: 400000,
      sellPropertyScenarioId: vwceScenarioId,
    });
    expect(wrongKind.ok).toBe(false);
    const unknownRef = await tooling.execute("buy_house_scenario", {
      priceEUR: 400000,
      fundBySellingScenarioIds: ["scenario.99"],
    });
    expect(unknownRef.ok).toBe(false);
    const badArgs = await tooling.execute("buy_house_scenario", {
      priceEUR: -5,
    });
    expect(badArgs.ok).toBe(false);
    const unknownTool = await tooling.execute("nope", {});
    expect(unknownTool.ok).toBe(false);
  });
});

describe("buildAskTooling — mortgage_terms", () => {
  it("registers payment, interest and stress tokens", async () => {
    const { ctx, tooling } = freshContext();
    const result = await tooling.execute("mortgage_terms", {
      principalEUR: 300000,
      rateAnnualPct: 3,
      termYears: 25,
    });
    expect(result.ok).toBe(true);
    const byId = Object.fromEntries(ctx.metrics.map((m) => [m.id, m.value]));
    expect(byId["tool.1.monthlyPaymentEUR"]).toBe(formatEUR("1422.63"));
    expect(byId["tool.1.stressMonthlyPaymentEUR"]).toBe(formatEUR("1753.77"));
  });
});
