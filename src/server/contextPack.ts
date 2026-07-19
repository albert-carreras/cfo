import { createId } from "@paralleldrive/cuid2";
import { desc } from "drizzle-orm";
import { computeSnapshot } from "@/calc/snapshot";
import { deriveState } from "@/calc/derive";
import { dec } from "@/calc/money";
import { db } from "./db";
import {
  accounts,
  assumptions,
  holdings,
  liabilities,
  otherAssets,
  plannedEvents,
  properties,
  revaluations,
  taxLots,
} from "./db/schema";
import { loadFacts } from "./facts";
import { latestHealthCheck } from "./healthCheck";
import { isAmountTBD, isTimingUnknown } from "@/shared/plans";

function eur(value: string | number | null | undefined): string {
  if (value == null) return "unknown";
  return `€${Number(value).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function pct(value: string | number | null | undefined): string {
  if (value == null) return "unknown";
  return `${(Number(value) * 100).toFixed(2)}%`;
}

export async function buildContextPack(now = new Date()) {
  const asOf = now.toISOString().slice(0, 10);
  const [
    bundle,
    accountRows,
    holdingRows,
    propertyRows,
    liabilityRows,
    otherRows,
    assumptionRows,
    eventRows,
    lotRows,
    observationRows,
    check,
  ] = await Promise.all([
    loadFacts(),
    db.select().from(accounts),
    db.select().from(holdings),
    db.select().from(properties),
    db.select().from(liabilities),
    db.select().from(otherAssets),
    db.select().from(assumptions),
    db.select().from(plannedEvents),
    db.select().from(taxLots),
    db.select().from(revaluations).orderBy(desc(revaluations.createdAt)),
    latestHealthCheck(),
  ]);
  const { facts } = bundle;
  const snapshot = computeSnapshot({
    snapshotId: createId(),
    asOf,
    reviewDue: false,
    facts,
  });
  const state = deriveState({
    accounts: facts.accounts,
    holdings: facts.holdings,
    movements: facts.movements,
    revaluations: facts.revaluations,
    asOf,
  });

  const latestObservationDate = (type: string, id: string, fallback: string) =>
    observationRows.find(
      (row) =>
        row.assetType === type && row.assetId === id && row.valuedAt <= asOf,
    )?.valuedAt ?? fallback;
  const propertyFactById = new Map(facts.properties.map((row) => [row.id, row]));
  const liabilityFactById = new Map(facts.liabilities.map((row) => [row.id, row]));
  const otherFactById = new Map((facts.otherAssets ?? []).map((row) => [row.id, row]));
  const valuationByHolding = new Map(
    snapshot.valuation.value.holdings.map((row) => [row.holdingId, row]),
  );
  const lotsByHolding = new Map<string, { cost: ReturnType<typeof dec>; rows: number }>();
  for (const lot of lotRows) {
    const current = lotsByHolding.get(lot.holdingId) ?? { cost: dec(0), rows: 0 };
    current.cost = current.cost.plus(lot.costBasisEUR);
    current.rows += 1;
    lotsByHolding.set(lot.holdingId, current);
  }

  const missing: string[] = [];
  const assumptionByKey = new Map(assumptionRows.map((row) => [row.key, row]));
  if (!assumptionByKey.get("monthlyNetIncome")?.value) {
    missing.push("Current net income is not recorded; affordability decisions need it.");
  }
  if (!assumptionByKey.get("monthlyHousingCost")?.value) {
    missing.push("Current recurring housing cost is not recorded.");
  }
  for (const property of propertyRows.filter((row) => !row.disposedAt)) {
    if (!property.purchasePrice) {
      missing.push(`${property.name} has no purchase price recorded.`);
    }
  }

  const nw = snapshot.netWorth.value;
  const fire = snapshot.fire.value;
  const lines: string[] = [
    "# Personal financial context",
    "",
    `Generated: ${asOf}`,
    "",
    "> This file contains verified personal facts and deterministic calculations. Treat dates and missing-data notes as part of the evidence. Ask before assuming a missing decision-critical fact.",
    "",
    "## Current picture (calculated)",
    "",
    `- Net worth: ${eur(nw.totalEUR)}`,
    `- Liquid cash: ${eur(nw.liquidEUR)}`,
    `- Investable assets: ${eur(nw.investableEUR)}`,
    `- Pension / locked assets: ${eur(nw.lockedEUR)}`,
    `- Property equity: ${eur(nw.illiquidEUR)}`,
    `- Other assets included in net worth: ${eur(nw.otherAssetsEUR)}`,
    `- Recorded debt: ${eur(nw.debtEUR)}`,
    `- Assets counted for the base independence plan: ${eur(nw.fireCountedEUR)}`,
    `- Monthly spend assumption: ${eur(fire.monthlySpendEUR)}`,
    `- Safe monthly spending at the recorded withdrawal rate: ${eur(fire.safeMonthlySpendEUR)}`,
    `- Zero-growth runway: ${fire.runwayYears == null ? "unknown" : `${fire.runwayYears.toFixed(2)} years`}`,
    `- Base plan holds: ${fire.bands?.base.holds == null ? "unknown" : fire.bands.base.holds ? "yes" : "no"}`,
    `- Conservative plan holds: ${fire.bands?.conservative.holds == null ? "unknown" : fire.bands.conservative.holds ? "yes" : "no"}`,
    `- Data quality: ${snapshot.dataQuality.value.score}`,
    "",
    "## Accounts (verified / latest observation)",
    "",
  ];
  for (const account of accountRows.filter((row) => !row.disposedAt)) {
    lines.push(
      `- ${account.name} [${account.type}]: ${eur(state.cashByAccount[account.id] ?? account.openingCash)} as of ${latestObservationDate("account", account.id, account.openingAsOf)}`,
    );
  }

  lines.push("", "## Investments (verified quantity; calculated market value)", "");
  for (const holding of holdingRows.filter((row) => !row.disposedAt)) {
    const line = valuationByHolding.get(holding.id);
    const lots = lotsByHolding.get(holding.id);
    lines.push(
      `- ${holding.ticker ?? holding.name}: quantity ${state.quantityByHolding[holding.id] ?? holding.openingQuantity}; market value ${eur(line?.valueEUR)}; price date ${line?.priceAsOf ?? "unpriced"}; quantity verified ${latestObservationDate("holding", holding.id, holding.openingAsOf)}${lots ? `; recorded open-lot cost basis ${eur(lots.cost.toFixed(2))} across ${lots.rows} lot(s)` : ""}`,
    );
  }

  lines.push("", "## Property", "");
  for (const property of propertyRows.filter((row) => !row.disposedAt)) {
    const current = propertyFactById.get(property.id);
    lines.push(
      `- ${property.name}: ${eur(current?.value ?? property.value)} at ${property.ownershipPct}% ownership; valued ${current?.valuedAt ?? property.valuedAt}; purchase price ${eur(property.purchasePrice)}; rent ${eur(property.rentMonthly)}/month; costs ${eur(property.costsMonthly)}/month${property.isPrimaryResidence ? "; primary residence" : ""}`,
    );
  }

  lines.push("", "## Other assets", "");
  const liveOthers = otherRows.filter((row) => !row.disposedAt);
  if (liveOthers.length === 0) lines.push("- None recorded.");
  for (const asset of liveOthers) {
    const current = otherFactById.get(asset.id);
    lines.push(
      `- ${asset.name} [${asset.category}]: ${eur(current?.value ?? asset.value)}; valued ${current?.valuedAt ?? asset.valuedAt}; ${asset.includeInNetWorth ? "included" : "excluded"} from planning net worth${asset.note ? `; ${asset.note}` : ""}`,
    );
  }

  lines.push("", "## Liabilities", "");
  const liveLiabilities = liabilityRows.filter((row) => !row.disposedAt);
  if (liveLiabilities.length === 0) lines.push("- None recorded.");
  for (const liability of liveLiabilities) {
    const current = liabilityFactById.get(liability.id);
    lines.push(
      `- ${liability.name ?? liability.type}: balance ${eur(current?.balance ?? liability.balance)}; rate ${pct(liability.rate)}; payment ${eur(liability.payment)}/month; balance date ${current?.valuedAt ?? liability.updatedAt.toISOString().slice(0, 10)}`,
    );
  }

  lines.push("", "## Planning inputs (verified assumptions)", "");
  for (const assumption of assumptionRows) {
    lines.push(
      `- ${assumption.key}: ${assumption.dateValue ?? assumption.value ?? "unknown"}; reviewed ${assumption.lastReviewedAt}; source ${assumption.source ?? "unspecified"}`,
    );
  }

  lines.push("", "## Planned major changes (forecasts, not facts)", "");
  const openEvents = eventRows.filter((row) => !row.realisedAt);
  if (openEvents.length === 0) lines.push("- None recorded.");
  for (const event of openEvents) {
    lines.push(
      `- ${event.type}: ${isAmountTBD(event.amount) ? "value TBD" : eur(event.amount)} around ${isTimingUnknown(event.date) ? "an unknown date" : event.date}; probability ${pct(event.probability)}; ${event.includedInBaseCase ? "important to the base plan" : "not included in the base plan"}${event.note ? `; ${event.note}` : ""}`,
    );
  }

  lines.push("", "## Data gaps and decision readiness", "");
  if (missing.length === 0 && snapshot.dataQuality.value.missing.length === 0) {
    lines.push("- No known general-purpose gaps. Reconfirm decision-specific facts before a major commitment.");
  } else {
    for (const item of [...snapshot.dataQuality.value.missing, ...missing]) {
      lines.push(`- ${item}`);
    }
  }
  if (check) {
    lines.push(
      "",
      "## Latest monthly check",
      "",
      `- Verdict: ${check.verdict}`,
      `- Checked: ${check.createdAt.toISOString().slice(0, 10)}`,
    );
    const report = check.report as { headline?: string; observations?: string[] } | null;
    if (report?.headline) lines.push(`- ${report.headline}`);
    for (const observation of report?.observations ?? []) lines.push(`- ${observation}`);
  }

  lines.push(
    "",
    "## Instructions for an AI using this file",
    "",
    "- Preserve the distinction between verified facts, deterministic calculations and your judgment.",
    "- Do not silently assume missing income, financing terms, taxes, transaction costs or sale proceeds.",
    "- For a major decision, identify which facts need refreshing before giving a recommendation.",
    "- Treat future events as intentions, not assets or liabilities that already exist.",
    "- Explain trade-offs directly and state uncertainty without generic disclaimers.",
    "",
  );
  return lines.join("\n");
}
