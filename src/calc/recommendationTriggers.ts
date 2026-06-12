import { dec, type Money } from "./money";
import type { CalcResult } from "./types";
import { VERSIONS } from "./config/versions";
import { RECOMMENDATION_TRIGGER_THRESHOLDS } from "./config/recommendationTriggers";
import type { ConcentrationValue } from "./concentration";

// Recommendation triggers — the deterministic conditions that PERMIT
// the monthly review to recommend anything. No fired trigger ⇒ no
// recommendation, enforced in the review validation (the model can never
// originate one from browsing the portfolio). Pure, versioned, tested.

export type FiredTrigger = {
  id:
    | "concentration-position"
    | "concentration-broker"
    | "concentration-real-estate"
    | "concentration-spain"
    | "cash-drag"
    | "overspend"
    | "harvestable-losses";
  label: string; // human-readable condition, no user figures beyond percents
  sourceIds: string[]; // fact/holding ids behind the condition (provenance)
};

export type RecommendationTriggersValue = {
  fired: FiredTrigger[];
};

export type UnrealizedPosition = {
  holdingId: string;
  costBasisEUR: Money; // open lots' remaining basis
  valueEUR: Money; // current market value of those shares
  sourceIds: string[];
};

export function recommendationTriggers(args: {
  snapshotId: string;
  concentration: ConcentrationValue;
  liquidEUR: Money;
  monthlySpendEUR: Money | null;
  safeMonthlySpendEUR: Money | null;
  realizedGainsEUR: Money; // this tax year's net realized gain
  unrealized: UnrealizedPosition[];
  inputs: string[];
  thresholds?: typeof RECOMMENDATION_TRIGGER_THRESHOLDS;
}): CalcResult<RecommendationTriggersValue> {
  const {
    snapshotId,
    concentration,
    liquidEUR,
    monthlySpendEUR,
    safeMonthlySpendEUR,
    realizedGainsEUR,
    unrealized,
    inputs,
    thresholds = RECOMMENDATION_TRIGGER_THRESHOLDS,
  } = args;

  const fired: FiredTrigger[] = [];

  const abovePositions = concentration.positions.filter((p) => p.above);
  if (abovePositions.length > 0) {
    fired.push({
      id: "concentration-position",
      label: `A single position exceeds ${abovePositions[0].ceilingPct}% of investable assets`,
      sourceIds: abovePositions.map((p) => p.holdingId),
    });
  }

  const aboveBrokers = concentration.brokers.filter((b) => b.above);
  if (aboveBrokers.length > 0) {
    fired.push({
      id: "concentration-broker",
      label: `A single broker holds more than ${aboveBrokers[0].ceilingPct}% of investable assets`,
      sourceIds: aboveBrokers.map((b) => b.accountId),
    });
  }

  if (concentration.realEstate?.above) {
    fired.push({
      id: "concentration-real-estate",
      label: `Real estate exceeds ${concentration.realEstate.ceilingPct}% of net worth`,
      sourceIds: [],
    });
  }

  if (concentration.spain?.above) {
    fired.push({
      id: "concentration-spain",
      label: `Spain exposure exceeds ${concentration.spain.ceilingPct}% of net worth`,
      sourceIds: [],
    });
  }

  // Cash drag: liquid cash above N months of the spend assumption.
  const spend = monthlySpendEUR === null ? null : dec(monthlySpendEUR);
  if (spend !== null && spend.greaterThan(0)) {
    const ceiling = spend.times(thresholds.cashDragMonths);
    if (dec(liquidEUR).greaterThan(ceiling)) {
      fired.push({
        id: "cash-drag",
        label: `Liquid cash exceeds ${thresholds.cashDragMonths} months of the spend assumption`,
        sourceIds: [],
      });
    }
  }

  // Overspend: the spend assumption above the safe monthly draw — the same
  // condition that moves the status (status.ts owns the calm-surface rule;
  // this only PERMITS the review to talk about it).
  if (
    spend !== null &&
    safeMonthlySpendEUR !== null &&
    spend.greaterThan(dec(safeMonthlySpendEUR))
  ) {
    fired.push({
      id: "overspend",
      label: "The spend assumption exceeds the safe monthly spend",
      sourceIds: [],
    });
  }

  // Harvestable losses: positions sitting below their remaining cost basis
  // while the year already carries realized gains they could offset.
  if (dec(realizedGainsEUR).greaterThan(0)) {
    const losers = unrealized.filter((p) =>
      dec(p.valueEUR).lessThan(dec(p.costBasisEUR)),
    );
    if (losers.length > 0) {
      fired.push({
        id: "harvestable-losses",
        label:
          "Unrealized losses exist that could offset this year's realized gains",
        sourceIds: losers.flatMap((p) => p.sourceIds),
      });
    }
  }

  return {
    snapshotId,
    value: { fired },
    source: VERSIONS.recommendationTriggers.source,
    version: VERSIONS.recommendationTriggers.version,
    inputs: [...new Set([...inputs, ...fired.flatMap((f) => f.sourceIds)])],
  };
}
