import type { DecisionOutcomesValue } from "@/calc/decisionOutcome";
import type { MaterialChangeValue } from "@/calc/materialChange";
import { dec, formatEUR } from "@/calc/money";
import { buildAskContext, type AskAssumption } from "./context";
import type { ProfileValue } from "@/calc/profile";
import type { StrategicSnapshot } from "@/calc/snapshot";
import type { CalcResult } from "@/calc/types";
import type { MetricEntry, ReviewContext } from "./types";

// Assembles the monthly review's context. Reuses the Ask boundary —
// buildAskContext is still the only place calculator output is serialized for
// a model, so the no-raw-dump guarantee is inherited — then swaps in the
// review brief and the review-only facts (month, tax-table version under
// verification, the deterministic material-change result, and the
// measured outcomes of the journaled decisions being revisited).

const REVIEW_QUESTION =
  "Run this month's scheduled review: reassurance digest, decisions revisited, regulatory watch, tax-table re-verification.";

const REVIEW_INSTRUCTIONS = `You are the scheduled monthly review analyst of a calm personal-finance app. You receive deterministic calculator output (metrics) about the user — never raw accounts — plus this month's deterministic material-change result. You may research the web, but only for the regulatory watch and tax-table verification below.

Produce a review report with these parts, all rules mandatory:

1. digest — a short reassurance digest ("checked X, Y, Z; nothing material changed" when true). Label every statement: "verified" = a fact the user entered, "calculated" = a deterministic calculator output, "judgment" = your opinion. Never write digits about the user; reference figures exclusively via {{metric-id}} tokens from the metrics list (the app renders the values — statements with typed digits are discarded). Verified/calculated statements must cite ids from allowedCitations.

2. decisionsRevisited — your read on each entry in review.decisionsRevisited: past journaled decisions re-measured against the current snapshot. The deltas are already computed deterministically and exposed as decision.N.* metrics — reference them via tokens, never re-derive or estimate them. Say what the movement means (a Judgment), not what it is (the app shows the Calculated deltas alongside). Attribute honestly: a delta reflects everything that happened since, not the decision alone. Empty when review.decisionsRevisited is empty — statements without a journaled decision are discarded.

3. findings — the regulatory watch for the user's profile (review.profileBrief): Spanish national + Cataluña IRPF scales, savings/general bands, rental taxation, wealth/solidarity tax, pension rules. Include announced, not-yet-effective reforms (status "announced") so the user gets a heads-up. Figures about the LAW are allowed here, but every finding must carry external web source URLs — unsourced findings are discarded. No market commentary or market opinions of any kind.

4. taxTables — re-verify the versioned tax tables named in review.taxTables against current law: the income tables (version) and, when present, the wealth-tax tables (wealthVersion). If either has drifted, set verdict "drifted" and propose a versioned bump in proposedVersion (e.g. "taxES.es-cat.2027.1" or "taxIP.es-cat.2027.1") — a proposal only, never applied automatically. Any verdict other than "unverified" needs web sources.

5. recommendation — optional, at most one, and ONLY when a deterministic trigger fired: review.triggers lists this month's fired conditions, and your recommendation must address one of them. If review.triggers is empty, recommendation must be null — the app discards any recommendation made without a fired trigger. It is a Judgment: phrase it conditionally, never as certainty. Figures about the user only via {{metric-id}} tokens; scenario.* metrics are the deterministic counterfactuals to compare when the fix involves selling or moving something. If it concerns an irreversible action (selling property or a position, leaving a job, pension withdrawal), set requiresManualReview true.

6. suggestsReview — true only when something material genuinely warrants the user's attention before next month. This is a calm monthly digest, not an alert channel.`;

// The signed-delta presentation: an explicit "+" so a token reads as a move,
// not a balance ("net worth is +€12,400 since").
function signedEUR(value: string): string {
  return dec(value).isNegative() ? formatEUR(value) : `+${formatEUR(value)}`;
}

function signedMonths(value: number): string {
  const word = Math.abs(value) === 1 ? "month" : "months";
  return `${value >= 0 ? "+" : ""}${value} ${word}`;
}

export function buildReviewContext(args: {
  snapshot: StrategicSnapshot;
  profile: CalcResult<ProfileValue> | null;
  assumptions: AskAssumption[];
  month: string; // "YYYY-MM"
  materialChange: MaterialChangeValue;
  previousReviewMonth: string | null;
  // Fired recommendation triggers — empty means validation drops
  // any recommendation the model returns.
  triggers: { id: string; label: string }[];
  // The accountability loop — null only when no decision has ever
  // been journaled; validation then forces decisionsRevisited empty.
  outcomes: CalcResult<DecisionOutcomesValue> | null;
}): ReviewContext {
  const base = buildAskContext({
    snapshot: args.snapshot,
    profile: args.profile,
    assumptions: args.assumptions,
    question: REVIEW_QUESTION,
    gateFired: false,
  });

  // Decision outcomes as positional decision.N metrics — same pattern as the
  // scenario tokens: the model can only reference the measured deltas, never
  // re-derive them; the app renders the values.
  const outcomeList = args.outcomes?.value.outcomes ?? [];
  const decisionMetrics: MetricEntry[] = [];
  const snapshotId = args.snapshot.snapshotId;
  const outcomeCites = args.outcomes
    ? [snapshotId, args.outcomes.source]
    : [];
  for (const [index, o] of outcomeList.entries()) {
    const id = `decision.${index + 1}`;
    decisionMetrics.push({
      id: `${id}.netWorthDeltaEUR`,
      label: `Δ net worth since the decision — ${o.question}`,
      value: signedEUR(o.netWorthDeltaEUR),
      citations: outcomeCites,
    });
    if (o.netWorthDeltaPct !== null) {
      decisionMetrics.push({
        id: `${id}.netWorthDeltaPct`,
        label: `Δ net worth % since the decision — ${o.question}`,
        value: `${dec(o.netWorthDeltaPct).isNegative() ? "" : "+"}${o.netWorthDeltaPct}%`,
        citations: outcomeCites,
      });
    }
    if (o.runwayDeltaMonths !== null) {
      decisionMetrics.push({
        id: `${id}.runwayDeltaMonths`,
        label: `Δ runway since the decision — ${o.question}`,
        value: signedMonths(o.runwayDeltaMonths),
        citations: outcomeCites,
      });
    }
  }

  const metrics = [...base.metrics, ...decisionMetrics];
  const allowedCitations = args.outcomes
    ? [...base.allowedCitations, args.outcomes.source]
    : base.allowedCitations;
  const citationLabels = args.outcomes
    ? {
        ...base.citationLabels,
        [args.outcomes.source]: `${args.outcomes.source} (${args.outcomes.version})`,
      }
    : base.citationLabels;

  const revisited = outcomeList.map((o, index) => ({
    id: `decision.${index + 1}`,
    question: o.question,
    decidedOn: o.decidedOn,
    statusThen: o.statusThen,
    statusNow: o.statusNow,
    reviewed: o.reviewed,
    chosenAction: o.chosenAction,
  }));

  const parsed = JSON.parse(base.input) as Record<string, unknown>;
  const input = JSON.stringify({
    ...parsed,
    // The decision metrics must be visible in the serialized input too — the
    // model only sees what crosses this boundary.
    metrics: metrics.map(({ id, label, value }) => ({ id, label, value })),
    allowedCitations,
    review: {
      month: args.month,
      previousReviewMonth: args.previousReviewMonth,
      materialChange: args.materialChange,
      triggers: args.triggers,
      decisionsRevisited: revisited,
      taxTables: {
        version: args.snapshot.taxES.version,
        year: args.snapshot.taxES.value.year,
        // The wealth-tax tables join the same monthly re-verification
        // (absent on legacy stored snapshots).
        wealthVersion: args.snapshot.taxES.value.wealth?.version ?? null,
      },
      profileBrief:
        "Cataluña (Spain) resident planning FIRE; broad ETFs plus a sector ETF; rental property; a pension plan.",
    },
  });

  return {
    ...base,
    metrics,
    allowedCitations,
    citationLabels,
    instructions: REVIEW_INSTRUCTIONS,
    input,
    month: args.month,
    triggers: args.triggers,
    revisited: revisited.map(({ id }) => ({ id })),
  };
}
