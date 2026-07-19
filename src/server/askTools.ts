import { z } from "zod";
import type { AskContext, AskTooling, MetricEntry } from "@/ai/types";
import { VERSIONS } from "@/calc/config/versions";
import { selectTaxConfigs } from "@/calc/config/taxRegistry";
import { formatEUR, money } from "@/calc/money";
import { mortgageTerms } from "@/calc/mortgage";
import {
  buyHouseScenario,
  type BuyHouseParams,
  type ComputeVariant,
  type ScenarioValue,
} from "@/calc/scenario";
import { computeSnapshot, type StrategicSnapshot } from "@/calc/snapshot";
import type { FactsBundle } from "./facts";

// The Ask tools: deterministic calculators behind a JSON-schema'd parameter
// surface, so a hypothetical ("a €400k house at 3%") becomes calculator
// output the model can only REFERENCE, never restate (invariant #2 — the
// question's numbers are the user's, the results are the calculators'). Each
// execution registers its figures as new {{metric-id}} tokens on the shared
// context; the digit validator stays untouched.

// Position/property references come in as the POSITIONAL scenario ids the
// model already sees ("scenario.3"), never as fact ids — the no-raw-dump
// boundary stays closed; the mapping back to fact ids happens here.
const buyHouseArgs = z.object({
  priceEUR: z.number().positive(),
  downPaymentPct: z.number().min(0).max(100).default(20),
  mortgageRateAnnualPct: z.number().min(0).max(20).default(3),
  termYears: z.number().int().min(1).max(40).default(25),
  // Extra down-payment percentages to compare in the same call ("how much
  // mortgage should I get" = the sweep across these).
  downPaymentPctVariants: z.array(z.number().min(0).max(100)).max(3).optional(),
  fundBySellingScenarioIds: z.array(z.string()).max(4).optional(),
  sellPropertyScenarioId: z.string().optional(),
  monthlyRentSavedEUR: z.number().min(0).optional(),
  isPrimaryResidence: z.boolean().default(true),
});

const mortgageArgs = z.object({
  principalEUR: z.number().positive(),
  rateAnnualPct: z.number().min(0).max(20),
  termYears: z.number().int().min(1).max(40),
});

export const ASK_TOOL_DEFINITIONS = [
  {
    name: "buy_house_scenario",
    description:
      "Deterministic what-if: buy a home in Cataluña at a given price. Computes ITP (progressive scale) + purchase costs, mortgage terms (payment, +2pt stress), the funding plan (liquid cash first, then optional position sales with their FIFO capital-gains tax, then an optional chained sale of an existing property), and the full snapshot diff (Δ net worth, runway after, safe spend after). Pass downPaymentPctVariants to compare mortgage sizes in one call. Reference positions/properties by the scenario ids from the context (e.g. \"scenario.2\"), never by name.",
    parameters: z.toJSONSchema(buyHouseArgs),
  },
  {
    name: "mortgage_terms",
    description:
      "Deterministic mortgage arithmetic only (no snapshot diff): French-amortization monthly payment, total interest, and the +2pt stress payment for a principal, annual rate (percent) and term.",
    parameters: z.toJSONSchema(mortgageArgs),
  },
];

// scenario.N → the fact id embedded in the stored scenario's key.
function factIdFromScenarioId(
  snapshot: StrategicSnapshot,
  scenarioId: string,
  kind: "sell-position" | "sell-property",
): string | null {
  const match = /^scenario\.(\d+)$/.exec(scenarioId.trim());
  if (!match) return null;
  const s = (snapshot.scenarios ?? [])[Number(match[1]) - 1];
  if (!s || s.value.kind !== kind) return null;
  return s.value.key.slice(`${kind}:`.length) || null;
}

function pct(value: number): string {
  return money(value / 100);
}

export function buildAskTooling(args: {
  ctx: AskContext;
  snapshot: StrategicSnapshot;
  bundle: FactsBundle;
  asOf: string;
}): AskTooling {
  const { ctx, snapshot, bundle, asOf } = args;
  const { facts } = bundle;
  const taxConfig = selectTaxConfigs(Number(asOf.slice(0, 4))).income;

  // The scenario runs on TODAY's facts; provenance stays tied to the answer's
  // snapshot id like every other metric in this context.
  const compute: ComputeVariant = (variantFacts) =>
    computeSnapshot({
      snapshotId: snapshot.snapshotId,
      asOf,
      reviewDue: false,
      facts: variantFacts,
      withScenarios: false,
    });
  const base = compute(facts);

  // Tool citations: the sources are legitimate provenance for the registered
  // tokens, so they join the allowed set (idempotently) up front.
  for (const v of [VERSIONS.scenario, VERSIONS.mortgage]) {
    if (!ctx.allowedCitations.includes(v.source)) {
      ctx.allowedCitations.push(v.source);
      ctx.citationLabels[v.source] = `${v.source} (${v.version})`;
    }
  }

  let seq = 0;
  const register = (entries: MetricEntry[]) => {
    ctx.metrics.push(...entries);
  };

  const runBuyHouse = (params: BuyHouseParams) => {
    const scenario = buyHouseScenario({
      base,
      facts,
      compute,
      params,
      holdingNameById: bundle.holdingNameById,
      propertyNameById: bundle.propertyNameById,
      taxConfig,
    });
    if (!scenario) return null;
    seq += 1;
    const id = `tool.${seq}`;
    const cites = [
      snapshot.snapshotId,
      VERSIONS.scenario.source,
      VERSIONS.mortgage.source,
    ];
    const v: ScenarioValue = scenario.value;
    const rows = Object.fromEntries(
      v.breakdown.map((r) => [r.label, r.valueEUR]),
    );
    const upperBound = v.basisIncomplete
      ? " (before unknown sale taxes — upper bound)"
      : "";
    const entry = (
      metricId: string,
      label: string,
      value: string | null,
    ): MetricEntry[] =>
      value === null
        ? []
        : [{ id: `${id}.${metricId}`, label: `${label} — ${v.label}`, value, citations: cites }];

    const metrics: MetricEntry[] = [
      ...entry("priceEUR", "Purchase price", formatEUR(params.priceEUR)),
      ...entry("itpEUR", "ITP (progressive scale)", formatEUR(String(-Number(rows["ITP (progressive scale)"])))),
      ...entry(
        "otherCostsEUR",
        "Other purchase costs (rough)",
        formatEUR(String(-Number(rows["Other purchase costs (rough)"]))),
      ),
      ...entry(
        "upfrontCashEUR",
        "Upfront cash needed (down payment + ITP + costs)",
        formatEUR(String(-Number(rows["Upfront cash needed"]))),
      ),
      ...entry(
        "mortgagePrincipalEUR",
        "Mortgage principal",
        formatEUR(v.mortgage!.principalEUR),
      ),
      ...entry(
        "monthlyPaymentEUR",
        "Monthly mortgage payment",
        formatEUR(v.mortgage!.monthlyPaymentEUR),
      ),
      ...entry(
        "stressMonthlyPaymentEUR",
        "Monthly payment at +2pt stress",
        formatEUR(v.mortgage!.stress.monthlyPaymentEUR),
      ),
      ...entry(
        "totalInterestEUR",
        "Total mortgage interest over the term",
        formatEUR(v.mortgage!.totalInterestEUR),
      ),
      ...entry(
        "oneOffTaxEUR",
        "One-off taxes (ITP + sale taxes)",
        v.oneOffTaxEUR === null ? null : formatEUR(v.oneOffTaxEUR),
      ),
      ...entry(
        "fundingCgTaxEUR",
        "CG tax on funding sales (due next year)",
        rows["CG tax on funding sales (due next year)"] == null
          ? null
          : formatEUR(String(-Number(rows["CG tax on funding sales (due next year)"]))),
      ),
      ...entry(
        "uncoveredShortfallEUR",
        "Upfront cash the plan does not cover",
        v.uncoveredShortfallEUR == null ? null : formatEUR(v.uncoveredShortfallEUR),
      ),
      ...entry(
        `netWorthDeltaEUR`,
        `Δ net worth${upperBound}`,
        formatEUR(v.diff.netWorthTotal.deltaEUR),
      ),
      ...entry(
        "runwayYearsAfter",
        "Runway after",
        v.diff.runwayYears.variant === null
          ? null
          : `${v.diff.runwayYears.variant} years`,
      ),
      ...entry(
        "safeMonthlySpendAfterEUR",
        "Safe monthly spend after",
        v.diff.safeMonthlySpend.variantEUR === null
          ? null
          : formatEUR(v.diff.safeMonthlySpend.variantEUR),
      ),
    ];
    register(metrics);
    return {
      id,
      label: v.label,
      irreversible: v.irreversible,
      statusAfter: v.diff.status.variant.label,
      exclusions: v.exclusions,
      metrics: metrics.map(({ id: mid, label, value }) => ({ id: mid, label, value })),
    };
  };

  return {
    definitions: ASK_TOOL_DEFINITIONS,
    async execute(name, rawArgs) {
      if (name === "mortgage_terms") {
        const parsed = mortgageArgs.safeParse(rawArgs);
        if (!parsed.success)
          return { ok: false, error: z.prettifyError(parsed.error) };
        const a = parsed.data;
        const result = mortgageTerms({
          snapshotId: snapshot.snapshotId,
          principalEUR: money(a.principalEUR),
          rateAnnual: pct(a.rateAnnualPct),
          termYears: a.termYears,
        });
        seq += 1;
        const id = `tool.${seq}`;
        const cites = [snapshot.snapshotId, VERSIONS.mortgage.source];
        const label = `${formatEUR(a.principalEUR)} at ${a.rateAnnualPct.toFixed(2)}% over ${a.termYears}y`;
        const metrics: MetricEntry[] = [
          {
            id: `${id}.monthlyPaymentEUR`,
            label: `Monthly payment — ${label}`,
            value: formatEUR(result.value.monthlyPaymentEUR),
            citations: cites,
          },
          {
            id: `${id}.totalInterestEUR`,
            label: `Total interest — ${label}`,
            value: formatEUR(result.value.totalInterestEUR),
            citations: cites,
          },
          {
            id: `${id}.stressMonthlyPaymentEUR`,
            label: `Monthly payment at +2pt stress — ${label}`,
            value: formatEUR(result.value.stress.monthlyPaymentEUR),
            citations: cites,
          },
        ];
        register(metrics);
        return {
          ok: true,
          output: {
            metrics: metrics.map(({ id: mid, label: l, value }) => ({ id: mid, label: l, value })),
          },
        };
      }

      if (name === "buy_house_scenario") {
        const parsed = buyHouseArgs.safeParse(rawArgs);
        if (!parsed.success)
          return { ok: false, error: z.prettifyError(parsed.error) };
        const a = parsed.data;

        const fundFromHoldingIds: string[] = [];
        for (const sid of a.fundBySellingScenarioIds ?? []) {
          const holdingId = factIdFromScenarioId(snapshot, sid, "sell-position");
          if (!holdingId)
            return {
              ok: false,
              error: `${sid} is not a sell-position scenario id from the context`,
            };
          fundFromHoldingIds.push(holdingId);
        }
        let sellPropertyId: string | undefined;
        if (a.sellPropertyScenarioId) {
          const propertyId = factIdFromScenarioId(
            snapshot,
            a.sellPropertyScenarioId,
            "sell-property",
          );
          if (!propertyId)
            return {
              ok: false,
              error: `${a.sellPropertyScenarioId} is not a sell-property scenario id from the context`,
            };
          sellPropertyId = propertyId;
        }

        const pcts = [...new Set([a.downPaymentPct, ...(a.downPaymentPctVariants ?? [])])];
        const results = [];
        for (const downPct of pcts) {
          const run = runBuyHouse({
            priceEUR: money(a.priceEUR),
            downPaymentRate: pct(downPct),
            mortgageRateAnnual: pct(a.mortgageRateAnnualPct),
            termYears: a.termYears,
            ...(fundFromHoldingIds.length > 0 ? { fundFromHoldingIds } : {}),
            ...(sellPropertyId ? { sellPropertyId } : {}),
            ...(a.monthlyRentSavedEUR != null
              ? { monthlyRentSavedEUR: money(a.monthlyRentSavedEUR) }
              : {}),
            isPrimaryResidence: a.isPrimaryResidence,
          });
          if (run) results.push(run);
        }
        if (results.length === 0)
          return { ok: false, error: "the scenario could not be computed" };
        return { ok: true, output: { scenarios: results } };
      }

      return { ok: false, error: `unknown tool: ${name}` };
    },
  };
}

// Appended to the Ask instructions only when tooling is attached.
export const TOOLS_NOTE = `\n\n8. Hypothetical decision questions (buying a home, sizing a mortgage) have deterministic tools — call buy_house_scenario or mortgage_terms with the parameters from the user's question instead of estimating anything yourself. Each call returns new metrics; reference them via {{metric-id}} tokens exactly like the snapshot metrics. Numbers MAY appear in tool arguments (they are the user's own figures); statement text still may not contain typed digits. If the question omits a parameter (rate, term, down payment), use the tool defaults and state, as a judgment, which assumptions you filled in. To compare mortgage sizes, pass downPaymentPctVariants. Refer to positions or properties only by the scenario ids in the context.`;
