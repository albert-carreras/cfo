import { dec, formatEURWhole } from "./money";
import type { CalcResult } from "./types";
import { VERSIONS } from "./config/versions";
import { FRESHNESS_DAYS } from "./config/freshness";
import { ageLabel, daysBetween, formatDate } from "./dates";
import type { FireValue } from "./fire";
import type { TaxValue } from "./tax";

// The short list of things worth your attention, replacing every status light
// and the old monthly AI note. Deterministic and pure: an empty list means
// nothing needs you. Ordered most important first.

export type ValueKind = keyof Pick<
  typeof FRESHNESS_DAYS,
  "cash" | "pension" | "units" | "property" | "debt" | "otherAsset"
>;

export type ConfirmedValue = {
  id: string;
  kind: ValueKind;
  name: string;
  lastConfirmed: string;
};

export type AttentionTarget =
  | { kind: "values" }
  | { kind: "item"; itemType: "account" | "holding"; id: string }
  | { kind: "tax"; year: number }
  | { kind: "plans" }
  | { kind: "inputs" };

export type AttentionItem = {
  id: string;
  level: "high" | "normal";
  title: string;
  detail: string | null;
  target: AttentionTarget;
};

export type AttentionValue = { items: AttentionItem[] };

export function attention(args: {
  snapshotId: string;
  asOf: string;
  values: ConfirmedValue[];
  // Held positions only (quantity > 0).
  prices: { holdingId: string; name: string; priceAsOf: string | null }[];
  negativeCash: { accountId: string; name: string }[];
  tax: TaxValue;
  plans: { id: string; label: string; date: string | null }[];
  monthlySpend: { lastReviewedAt: string } | null;
  safeWithdrawalRate: { lastReviewedAt: string } | null;
  fire: FireValue;
  inputs?: string[];
}): CalcResult<AttentionValue> {
  const { snapshotId, asOf } = args;
  const items: AttentionItem[] = [];

  for (const account of args.negativeCash) {
    items.push({
      id: `negative-${account.accountId}`,
      level: "high",
      title: `${account.name} shows a negative balance`,
      detail: "Set its real balance.",
      target: { kind: "item", itemType: "account", id: account.accountId },
    });
  }

  const unpriced = args.prices.filter(
    (row) =>
      row.priceAsOf === null ||
      daysBetween(row.priceAsOf, asOf) > FRESHNESS_DAYS.marketPrice,
  );
  if (unpriced.length > 0) {
    const never = unpriced.filter((row) => row.priceAsOf === null);
    items.push({
      id: "prices",
      level: "high",
      title:
        unpriced.length === 1
          ? `No current price for ${unpriced[0].name}`
          : `No current price for ${unpriced.length} investments`,
      detail:
        (unpriced.length > 1 ? `${unpriced.map((row) => row.name).join(", ")}. ` : "") +
        (never.length > 0
          ? "Without a price they count as €0. Check the ticker."
          : "The daily price feed has stopped updating them. Check the ticker."),
      target:
        unpriced.length === 1
          ? { kind: "item", itemType: "holding", id: unpriced[0].holdingId }
          : { kind: "values" },
    });
  }

  for (const year of args.tax.years) {
    if (year.settled) continue;
    const overdue = asOf > year.dueBy;
    if (dec(year.taxEUR).greaterThan(0)) {
      items.push({
        id: `tax-${year.year}`,
        level: overdue ? "high" : "normal",
        title: overdue
          ? `${year.year} tax on sales was due by ${formatDate(year.dueBy)}`
          : `Keep about ${formatEURWhole(year.taxEUR)} aside for ${year.year} tax on sales`,
        detail: overdue
          ? "Mark it paid once it is settled."
          : `Estimated on ${formatEURWhole(year.gainEUR)} of realised gains. Paid with the return, due by ${formatDate(year.dueBy)}. Already deducted from your net worth.`,
        target: { kind: "tax", year: year.year },
      });
    }
    if (year.unknownBasisCount > 0) {
      items.push({
        id: `tax-basis-${year.year}`,
        level: "normal",
        title:
          year.unknownBasisCount === 1
            ? `1 sale in ${year.year} has no cost basis`
            : `${year.unknownBasisCount} sales in ${year.year} have no cost basis`,
        detail: "The tax estimate leaves them out until you add what you paid.",
        target: { kind: "tax", year: year.year },
      });
    }
  }

  const stale = args.values
    .map((row) => ({ ...row, age: daysBetween(row.lastConfirmed, asOf) }))
    .filter((row) => row.age > FRESHNESS_DAYS[row.kind])
    .sort((a, b) => b.age - a.age);
  if (stale.length > 0) {
    items.push({
      id: "stale-values",
      level: "normal",
      title:
        stale.length === 1
          ? `${stale[0].name} hasn't been confirmed in ${ageLabel(stale[0].age)}`
          : `${stale.length} values haven't been confirmed in a while`,
      detail:
        stale.length === 1
          ? null
          : stale.map((row) => `${row.name} (${ageLabel(row.age)})`).join(", "),
      target: { kind: "values" },
    });
  }

  for (const plan of args.plans) {
    if (plan.date && plan.date < asOf) {
      items.push({
        id: `plan-${plan.id}`,
        level: "normal",
        title: `${plan.label} was planned for ${formatDate(plan.date)}`,
        detail: "Update the plan, or mark it done once the record reflects it.",
        target: { kind: "plans" },
      });
    }
  }

  if (!args.monthlySpend || !args.safeWithdrawalRate) {
    items.push({
      id: "inputs-missing",
      level: "normal",
      title: !args.monthlySpend
        ? "Set your monthly spending"
        : "Set a safe withdrawal rate",
      detail: "Needed for the safe-spending line.",
      target: { kind: "inputs" },
    });
  } else if (
    daysBetween(args.monthlySpend.lastReviewedAt, asOf) > FRESHNESS_DAYS.planningInputs
  ) {
    items.push({
      id: "inputs-stale",
      level: "normal",
      title: "Your monthly spending figure is over a year old",
      detail: "Check it still matches how you live.",
      target: { kind: "inputs" },
    });
  }

  const fire = args.fire;
  if (fire.fits === false && fire.monthlySpendEUR && fire.safeMonthlySpendEUR) {
    items.push({
      id: "spend-above-safe",
      level: "normal",
      title: "Spending is above the safe level",
      detail: `${formatEURWhole(fire.monthlySpendEUR)}/month against ${formatEURWhole(fire.safeMonthlySpendEUR)}/month that your cash and investments can safely pay.`,
      target: { kind: "inputs" },
    });
  }

  items.sort((a, b) => (a.level === b.level ? 0 : a.level === "high" ? -1 : 1));

  return {
    snapshotId,
    value: { items },
    source: VERSIONS.attention.source,
    version: VERSIONS.attention.version,
    inputs: args.inputs ?? [],
  };
}

