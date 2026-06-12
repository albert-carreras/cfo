import { dec, type Money } from "./money";
import type { CalcResult } from "./types";
import { VERSIONS } from "./config/versions";
import type { SnapshotSummary } from "./materialChange";
import type { StatusLevel } from "./status";

// The accountability loop: every journaled decision is re-evaluated
// against the current snapshot — the decision's pinned summary ("then") vs the
// summary now. Purely Calculated: the deltas are arithmetic over two summaries
// the user can already see; what the deltas MEAN stays a Judgment for the
// review's voice. The advice becomes auditable the same way the numbers are.

export type DecisionThen = {
  id: string;
  question: string;
  decidedOn: string; // YYYY-MM-DD — the decision row's creation date
  reviewed: boolean; // markReviewed happened (the manual-review unlock)
  chosenAction: string | null;
  then: SnapshotSummary; // summary of the snapshot the decision was made on
};

export type DecisionOutcome = {
  decisionId: string;
  question: string;
  decidedOn: string;
  reviewed: boolean;
  chosenAction: string | null;
  netWorthThenEUR: Money;
  netWorthNowEUR: Money;
  netWorthDeltaEUR: Money;
  netWorthDeltaPct: Money | null; // null when "then" net worth was zero
  runwayThenMonths: number | null;
  runwayNowMonths: number | null;
  runwayDeltaMonths: number | null; // null when either side is unknown
  statusThen: StatusLevel;
  statusNow: StatusLevel;
};

export type DecisionOutcomesValue = {
  comparedAsOf: string; // the current snapshot's asOf — "what happened since"
  outcomes: DecisionOutcome[]; // oldest decision first
};

export function decisionOutcomes(args: {
  snapshotId: string;
  current: SnapshotSummary;
  decisions: DecisionThen[];
}): CalcResult<DecisionOutcomesValue> {
  const { snapshotId, current, decisions } = args;

  const outcomes = [...decisions]
    .sort((a, b) =>
      a.decidedOn === b.decidedOn
        ? a.id.localeCompare(b.id)
        : a.decidedOn.localeCompare(b.decidedOn),
    )
    .map((d): DecisionOutcome => {
      const thenNw = dec(d.then.totalNetWorthEUR);
      const nowNw = dec(current.totalNetWorthEUR);
      const deltaNw = nowNw.minus(thenNw);
      return {
        decisionId: d.id,
        question: d.question,
        decidedOn: d.decidedOn,
        reviewed: d.reviewed,
        chosenAction: d.chosenAction,
        netWorthThenEUR: thenNw.toFixed(2),
        netWorthNowEUR: nowNw.toFixed(2),
        netWorthDeltaEUR: deltaNw.toFixed(2),
        netWorthDeltaPct: thenNw.isZero()
          ? null
          : deltaNw.dividedBy(thenNw.abs()).times(100).toFixed(2),
        runwayThenMonths: d.then.runwayMonths,
        runwayNowMonths: current.runwayMonths,
        runwayDeltaMonths:
          d.then.runwayMonths === null || current.runwayMonths === null
            ? null
            : current.runwayMonths - d.then.runwayMonths,
        statusThen: d.then.status,
        statusNow: current.status,
      };
    });

  return {
    snapshotId,
    value: { comparedAsOf: current.asOf, outcomes },
    source: VERSIONS.decisionOutcome.source,
    version: VERSIONS.decisionOutcome.version,
    inputs: decisions.map((d) => d.id),
  };
}
