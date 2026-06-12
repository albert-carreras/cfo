import type { StrategicSnapshot } from "@/calc/snapshot";
import type { ProfileValue } from "@/calc/profile";
import type { CalcResult } from "@/calc/types";
import { formatEUR } from "@/calc/money";
import type { AskContext, MetricEntry } from "./types";

// Assembles everything the model is allowed to see. This module is the
// "no raw account dump" boundary: it accepts ONLY calculator output and
// assumption summaries (never accounts/movements/prices, and never the
// CalcResult `inputs` id lists), and it must not import from src/server/*.

export type AskAssumption = {
  id: string;
  key: string;
  value: string | null;
  dateValue: string | null;
  source: string | null;
};

const INSTRUCTIONS = `You are the analyst voice of a calm personal-finance app. You receive only deterministic calculator output (metrics) about the user — never raw accounts or documents.

Rules, all mandatory:
1. Label every statement: "verified" = a fact the user entered (assumptions), "calculated" = a deterministic calculator output, "judgment" = your opinion or a rule of thumb. Never blur them.
2. Never write digits in statement text. Reference every figure exclusively via {{metric-id}} tokens from the provided metrics list; the app renders the values. A statement containing typed digits will be discarded.
3. Every verified or calculated statement must cite ids from allowedCitations.
4. Judgment statements are opinions — phrase them with appropriate uncertainty, never as certainty.
5. If the question concerns an irreversible action (selling property or an investment position, leaving a job, pension or large cash withdrawal), set requiresManualReview to true and do not recommend acting with certainty.
6. Set suggestsReview to true only when something material genuinely warrants a scheduled review. Never volunteer market opinions.
7. Metrics whose id starts with "scenario." are deterministic counterfactuals from the scenario engine ("what if I sold X") — when the question concerns such a decision, compare those metrics instead of estimating anything yourself. Each scenario lists its exclusions; acknowledge them. A scenario marked irreversible stays behind manual review.`;

const GATE_NOTE = `\n\nThis question touches an irreversible action. requiresManualReview is already locked to true by the app; keep every recommendation conditional.`;

function metric(
  id: string,
  label: string,
  value: string | null,
  citations: string[],
): MetricEntry[] {
  return value === null ? [] : [{ id, label, value, citations }];
}

export function buildAskContext(args: {
  snapshot: StrategicSnapshot;
  profile: CalcResult<ProfileValue> | null;
  assumptions: AskAssumption[];
  question: string;
  gateFired: boolean;
}): AskContext {
  const { snapshot, profile, assumptions, question, gateFired } = args;
  const { snapshotId, asOf } = snapshot;

  const calcs = {
    netWorth: snapshot.netWorth,
    fire: snapshot.fire,
    taxES: snapshot.taxES,
    dataQuality: snapshot.dataQuality,
    status: snapshot.status,
  };

  const cite = (calc: { source: string }) => [snapshotId, calc.source];
  const eur = (value: string | null) => (value === null ? null : formatEUR(value));

  const nw = snapshot.netWorth.value;
  const fr = snapshot.fire.value;
  const tax = snapshot.taxES.value;

  // Assumption-driven metrics must cite the assumption rows they consume —
  // the calculator source alone is not the full provenance there.
  const assumptionId = (key: string) =>
    assumptions.find((a) => a.key === key)?.id;
  const returnInflationIds = ["expectedReturn", "longRunInflation"]
    .map(assumptionId)
    .filter((x): x is string => Boolean(x));
  const realCites = [...cite(snapshot.fire), ...returnInflationIds];

  const metrics: MetricEntry[] = [
    ...metric("netWorth.totalEUR", "Total net worth", eur(nw.totalEUR), cite(snapshot.netWorth)),
    ...metric("netWorth.liquidEUR", "Liquid assets", eur(nw.liquidEUR), cite(snapshot.netWorth)),
    ...metric("netWorth.investableEUR", "Investable assets", eur(nw.investableEUR), cite(snapshot.netWorth)),
    ...metric("netWorth.fireCountedEUR", "FIRE-counted assets", eur(nw.fireCountedEUR), cite(snapshot.netWorth)),
    ...metric("netWorth.lockedEUR", "Locked assets (pension)", eur(nw.lockedEUR), cite(snapshot.netWorth)),
    ...metric("netWorth.illiquidEUR", "Illiquid assets (property equity)", eur(nw.illiquidEUR), cite(snapshot.netWorth)),
    ...metric("fire.monthlySpendEUR", "Monthly spend (assumption)", eur(fr.monthlySpendEUR), cite(snapshot.fire)),
    ...metric(
      "fire.runwayMonths",
      "Runway",
      fr.runwayMonths === null ? null : `${fr.runwayMonths} months`,
      cite(snapshot.fire),
    ),
    ...metric(
      "fire.runwayYears",
      "Runway in years",
      fr.runwayYears === null ? null : `${fr.runwayYears} years`,
      cite(snapshot.fire),
    ),
    ...metric("fire.safeMonthlySpendEUR", "Safe monthly spend", eur(fr.safeMonthlySpendEUR), cite(snapshot.fire)),
    ...metric(
      "fire.safeWithdrawalRate",
      "Safe withdrawal rate",
      fr.safeWithdrawalRate === null
        ? null
        : `${(Number(fr.safeWithdrawalRate) * 100).toFixed(2)}%`,
      cite(snapshot.fire),
    ),
    ...metric(
      "fire.actualWithdrawalRate",
      "Actual withdrawal rate (current spend vs the FIRE-counted pile)",
      fr.actualWithdrawalRate == null
        ? null
        : `${(Number(fr.actualWithdrawalRate) * 100).toFixed(2)}%`,
      cite(snapshot.fire),
    ),
    // fire.v2 real view — assumption-driven, so these metrics also cite the
    // assumption rows they consume; absent (dropped) on degraded/pre-v2
    // snapshots because fr.real is omitted there.
    ...metric(
      "fire.realRunwayYears",
      "Runway if the pile grows at your assumed real return (assumption-driven)",
      fr.real === undefined
        ? null
        : fr.real.sustainable
          ? "sustainable indefinitely at the assumed real return"
          : `${fr.real.realRunwayYears} years`,
      realCites,
    ),
    ...metric(
      "fire.realReturnAnnual",
      "Assumed real return (nominal expected return less long-run inflation)",
      fr.real === undefined
        ? null
        : `${(Number(fr.real.realReturnAnnual) * 100).toFixed(2)}% real`,
      realCites,
    ),
    // FIRE bands — absent on pre-band stored snapshots; metric() drops nulls.
    ...metric(
      "fire.bands.conservative.runwayYears",
      "Runway in the conservative band (stressed spend, rate and pile)",
      fr.bands?.conservative.runwayYears == null
        ? null
        : `${fr.bands.conservative.runwayYears} years`,
      cite(snapshot.fire),
    ),
    ...metric(
      "fire.bands.conservative.safeMonthlySpendEUR",
      "Safe monthly spend in the conservative band",
      eur(fr.bands?.conservative.safeMonthlySpendEUR ?? null),
      cite(snapshot.fire),
    ),
    ...metric(
      "fire.bands.conservative.holds",
      "Whether the plan holds in the conservative band",
      fr.bands?.conservative.holds == null
        ? null
        : fr.bands.conservative.holds
          ? "holds"
          : "does not hold",
      cite(snapshot.fire),
    ),
    ...metric(
      "fire.bands.optimistic.runwayYears",
      "Runway in the optimistic band",
      fr.bands?.optimistic.runwayYears == null
        ? null
        : `${fr.bands.optimistic.runwayYears} years`,
      cite(snapshot.fire),
    ),
    ...metric(
      "fire.failureModes.spendRisePct",
      "Spend rise that breaks the base plan",
      fr.bands?.failureModes.spendRisePct == null
        ? null
        : `${fr.bands.failureModes.spendRisePct}%`,
      cite(snapshot.fire),
    ),
    ...metric(
      "fire.failureModes.assetDropPct",
      "Pile drop that breaks the base plan",
      fr.bands?.failureModes.assetDropPct == null
        ? null
        : `${fr.bands.failureModes.assetDropPct}%`,
      cite(snapshot.fire),
    ),
    ...metric(
      "fire.failureModes.swrFloorPct",
      "Minimum withdrawal rate the base plan needs",
      fr.bands?.failureModes.swrFloorPct == null
        ? null
        : `${fr.bands.failureModes.swrFloorPct}%`,
      cite(snapshot.fire),
    ),
    ...metric("taxES.totalTaxEUR", `Estimated ${tax.year} tax`, eur(tax.totalTaxEUR), cite(snapshot.taxES)),
    ...metric("taxES.savingsTaxEUR", "Savings-base tax", eur(tax.savingsTaxEUR), cite(snapshot.taxES)),
    ...metric("taxES.generalTaxEUR", "General-base tax", eur(tax.generalTaxEUR), cite(snapshot.taxES)),
    // Absent on legacy stored snapshots; metric() drops nulls.
    ...metric(
      "taxES.wealthTaxEUR",
      "Wealth tax (IP, after the IRPF–IP cap)",
      eur(tax.wealth?.quotaEUR ?? null),
      cite(snapshot.taxES),
    ),
    ...metric(
      "taxES.lossCarryForwardRemainingEUR",
      "Loss carry-forward still available",
      eur(tax.lossCarryForwardRemainingEUR ?? null),
      cite(snapshot.taxES),
    ),
    ...metric("dataQuality.score", "Data quality", snapshot.dataQuality.value.score, cite(snapshot.dataQuality)),
    ...metric("status.label", "Status", snapshot.status.value.label, cite(snapshot.status)),
    ...metric(
      "profile.ageYears",
      "Age",
      profile?.value.ageYears == null ? null : String(profile.value.ageYears),
      profile ? [snapshotId, profile.source, ...profile.inputs] : [],
    ),
  ];

  // Scenario metrics: each stored counterfactual exposes its diff as
  // tokens, so "should I sell X?" answers can only reference deterministic
  // scenario output. Ids are positional on purpose — the scenario KEY embeds
  // fact ids, which never cross the no-raw-dump boundary; the label names it.
  const scenarios = snapshot.scenarios ?? [];
  for (const [index, s] of scenarios.entries()) {
    const id = `scenario.${index + 1}`;
    const cites = [snapshotId, s.source];
    const d = s.value.diff;
    // basisIncomplete (scenario.es.2026.7): the Δ excludes the unknown sale
    // taxes — the label must say so wherever the number can be cited.
    const upperBound = s.value.basisIncomplete
      ? " (before unknown sale taxes — upper bound)"
      : "";
    metrics.push(
      ...metric(
        `${id}.netWorthDeltaEUR`,
        `Δ net worth — ${s.value.label}${upperBound}`,
        eur(d.netWorthTotal.deltaEUR),
        cites,
      ),
      ...metric(
        `${id}.runwayYearsAfter`,
        `Runway after — ${s.value.label}`,
        d.runwayYears.variant === null ? null : `${d.runwayYears.variant} years`,
        cites,
      ),
      ...metric(
        `${id}.safeMonthlySpendAfterEUR`,
        `Safe monthly spend after — ${s.value.label}`,
        eur(d.safeMonthlySpend.variantEUR),
        cites,
      ),
      ...metric(`${id}.oneOffTaxEUR`, `One-off tax — ${s.value.label}`, eur(s.value.oneOffTaxEUR), cites),
      ...metric(
        `${id}.spreadTaxSavingEUR`,
        `Tax saved selling gradually — ${s.value.label}`,
        eur(s.value.spreadTaxSavingEUR ?? null),
        cites,
      ),
      // The grown spread delta (scenario.es.2026.5) — assumption-driven, so it
      // cites the expectedReturn row too. Sign-aware: negative = spreading
      // costs MORE tax when the position grows at the assumed return.
      ...metric(
        `${id}.spreadTaxDeltaGrownEUR`,
        `Tax difference selling gradually if grown at your assumed return (negative = spreading costs more) — ${s.value.label}`,
        eur(s.value.spreadTaxDeltaGrownEUR ?? null),
        [...cites, ...(assumptionId("expectedReturn") ? [assumptionId("expectedReturn")!] : [])],
      ),
    );
    // Sell-property yield comparison (propertyYield.v1) — assumption-driven,
    // so these also cite the assumption rows behind the ETF side.
    const yc = s.value.yieldComparison;
    if (yc?.realNetYield != null && yc.etfRealReturn != null) {
      const yieldCites = [...cites, ...returnInflationIds];
      const pctOf = (value: string) => `${(Number(value) * 100).toFixed(2)}%`;
      metrics.push(
        ...metric(
          `${id}.realNetYieldPct`,
          `Unlevered real net rental yield — ${s.value.label}`,
          pctOf(yc.realNetYield),
          yieldCites,
        ),
        ...metric(
          `${id}.etfRealReturnPct`,
          `Assumed real ETF return (your assumption) — ${s.value.label}`,
          pctOf(yc.etfRealReturn),
          yieldCites,
        ),
        ...metric(
          `${id}.realYieldGapPct`,
          `Yield gap vs the assumed ETF return (negative = the ETF assumption wins) — ${s.value.label}`,
          yc.realGap == null ? null : pctOf(yc.realGap),
          yieldCites,
        ),
      );
    }
  }

  const scenarioSource = scenarios[0]?.source;
  const allowedCitations = [
    snapshotId,
    ...Object.values(calcs).map((c) => c.source),
    ...(profile ? [profile.source] : []),
    ...(scenarioSource ? [scenarioSource] : []),
    ...assumptions.map((a) => a.id),
  ];

  const citationLabels: Record<string, string> = Object.fromEntries([
    [snapshotId, `Strategic snapshot · ${asOf}`],
    ...Object.values(calcs).map((c) => [c.source, `${c.source} (${c.version})`]),
    ...(profile ? [[profile.source, `${profile.source} (${profile.version})`]] : []),
    ...(scenarioSource
      ? [[scenarioSource, `${scenarioSource} (${scenarios[0].version})`]]
      : []),
    ...assumptions.map((a) => [
      a.id,
      `${a.key} assumption${a.source ? ` (${a.source})` : ""}`,
    ]),
  ]);

  const input = JSON.stringify({
    asOf,
    snapshotId,
    calculators: Object.fromEntries(
      Object.entries(calcs).map(([name, c]) => [
        name,
        { source: c.source, version: c.version },
      ]),
    ),
    status: snapshot.status.value,
    dataQuality: {
      score: snapshot.dataQuality.value.score,
      missing: snapshot.dataQuality.value.missing,
    },
    metrics: metrics.map(({ id, label, value }) => ({ id, label, value })),
    // Decision scenarios, summarized: the diffs are already in the metrics;
    // this gives the model the qualifying context (exclusions, irreversibility).
    // No `key` here — it embeds fact ids (the no-raw-dump boundary).
    scenarios: scenarios.map((s, index) => ({
      id: `scenario.${index + 1}`,
      label: s.value.label,
      kind: s.value.kind,
      irreversible: s.value.irreversible,
      exclusions: s.value.exclusions,
      statusAfter: s.value.diff.status.variant.label,
    })),
    profile: {
      region: "Cataluña, Spain",
      planning: "FIRE",
      ageYears: profile?.value.ageYears ?? null,
    },
    assumptions: assumptions.map((a) => ({
      id: a.id,
      key: a.key,
      value: a.value ?? a.dateValue,
      source: a.source,
    })),
    allowedCitations,
    question,
  });

  return {
    instructions: gateFired ? INSTRUCTIONS + GATE_NOTE : INSTRUCTIONS,
    input,
    metrics,
    allowedCitations,
    citationLabels,
  };
}
