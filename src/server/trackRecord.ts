import { createId } from "@paralleldrive/cuid2";
import {
  decisionOutcomes,
  type DecisionOutcomesValue,
} from "@/calc/decisionOutcome";
import { snapshotSummary } from "@/calc/materialChange";
import { computeSnapshot } from "@/calc/snapshot";
import type { CalcResult } from "@/calc/types";
import { listDecisionsWithContext } from "./decisions";
import { loadFacts } from "./facts";
import { isReviewDue, listSnapshots } from "./snapshots";

// The live track record: every journaled decision re-measured against
// TODAY's computed state. This is the same accountability math the monthly
// review pins per row — surfaced live on /ask so the decision journal shows each
// answer alongside what happened since. Returns null when nothing's journaled.
export async function liveTrackRecord(
  asOf: string,
): Promise<CalcResult<DecisionOutcomesValue> | null> {
  const [bundle, strategicRows, journal] = await Promise.all([
    loadFacts(),
    listSnapshots("strategic", 1),
    listDecisionsWithContext(),
  ]);
  if (journal.length === 0) return null;
  const reviewDue = isReviewDue(strategicRows[0]?.computedAt ?? null, asOf);
  const current = computeSnapshot({
    snapshotId: createId(),
    asOf,
    reviewDue,
    facts: bundle.facts,
  });
  return decisionOutcomes({
    snapshotId: current.snapshotId,
    current: snapshotSummary(current),
    decisions: journal,
  });
}
