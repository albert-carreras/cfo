import { dec } from "./money";
import type { CalcResult } from "./types";
import { VERSIONS } from "./config/versions";
import { CONFIDENCE_CONFIG } from "./config/confidence";
import type { DataQualityValue } from "./dataQuality";
import type { StrategicSnapshot } from "./snapshot";

// The SLOW confidence score (principle #11): an EMA-smoothed composite over the
// internal snapshot history the daily job accumulates. It answers
// "given the inputs, is the plan sound?" — deliberately separate from data
// quality's "do we have enough fresh inputs?" (principle #7), though data
// quality is one (small) component of the composite.
//
// Pure: the caller passes the observation series (oldest→newest, the current
// snapshot last); nothing here touches a clock or a DB. Like materialChange and
// status it is a meta-calc over snapshot outputs — provenance lives in the
// snapshot ids it consumed.

export type ConfidenceObservation = {
  snapshotId: string;
  asOf: string; // YYYY-MM-DD
  runwayMonths: number | null;
  monthlySpendEUR: string; // "0.00" when no spend logged
  safeMonthlySpendEUR: string | null; // null when no SWR assumption
  dataQuality: DataQualityValue["score"];
};

export type ConfidenceComponent = {
  key: "spendCoverage" | "runway" | "dataQuality";
  label: string;
  score: number; // 0–100, today's raw component
  weight: number; // effective (reweighted) share of the composite
};

export type ConfidenceValue = {
  score: number; // 0–100, EMA-smoothed over the history
  rawScore: number; // 0–100, today's unsmoothed composite
  components: ConfidenceComponent[]; // breakdown of today's raw composite
  observations: number; // history length the EMA consumed
  firstObservedAt: string | null; // asOf of the oldest observation
};

const COMPONENT_LABELS: Record<ConfidenceComponent["key"], string> = {
  spendCoverage: "Safe spend covers actual spend",
  runway: "Runway vs long-horizon target",
  dataQuality: "Data quality",
};

function clamp100(n: number): number {
  return Math.min(100, Math.max(0, n));
}

// Today's unsmoothed composite. Components whose inputs are missing are
// skipped and the remaining weights renormalised — a missing input is data
// quality's job to flag, not a reason to crater the plan-soundness score.
function rawComposite(obs: ConfidenceObservation): {
  raw: number;
  components: ConfidenceComponent[];
} {
  const cfg = CONFIDENCE_CONFIG;
  const parts: { key: ConfidenceComponent["key"]; score: number; weight: number }[] = [];

  const spend = dec(obs.monthlySpendEUR);
  if (spend.greaterThan(0) && obs.safeMonthlySpendEUR !== null) {
    const ratio = dec(obs.safeMonthlySpendEUR).dividedBy(spend).toNumber();
    parts.push({
      key: "spendCoverage",
      score: clamp100(Math.min(ratio, 1) * 100),
      weight: cfg.weights.spendCoverage,
    });
  }

  if (obs.runwayMonths !== null) {
    parts.push({
      key: "runway",
      score: clamp100((obs.runwayMonths / cfg.runwayTargetMonths) * 100),
      weight: cfg.weights.runway,
    });
  }

  parts.push({
    key: "dataQuality",
    score: cfg.dataQualityScores[obs.dataQuality],
    weight: cfg.weights.dataQuality,
  });

  const totalWeight = parts.reduce((acc, p) => acc + p.weight, 0);
  const components = parts.map((p) => ({
    key: p.key,
    label: COMPONENT_LABELS[p.key],
    score: Math.round(p.score),
    weight: p.weight / totalWeight,
  }));
  const raw = parts.reduce(
    (acc, p) => acc + p.score * (p.weight / totalWeight),
    0,
  );
  return { raw, components };
}

function daysBetween(from: string, to: string): number {
  return Math.max(0, (Date.parse(to) - Date.parse(from)) / 86_400_000);
}

export function confidence(args: {
  snapshotId: string;
  // Oldest→newest; the CURRENT snapshot's observation must be last. Unsorted
  // input is sorted here (by asOf) so the EMA is deterministic regardless of
  // query order.
  observations: ConfidenceObservation[];
}): CalcResult<ConfidenceValue> {
  const { snapshotId } = args;
  const obs = [...args.observations].sort((a, b) =>
    a.asOf === b.asOf ? a.snapshotId.localeCompare(b.snapshotId) : a.asOf < b.asOf ? -1 : 1,
  );
  if (obs.length === 0) {
    throw new Error("confidence: needs at least the current observation");
  }

  // Gap-aware EMA: each new observation pulls the score toward today's raw
  // composite by an amount that grows with the days elapsed — so sparse
  // histories decay correctly and same-day duplicates change nothing.
  const halfLife = CONFIDENCE_CONFIG.halfLifeDays;
  let ema: number | null = null;
  let prevAsOf: string | null = null;
  let lastRaw = 0;
  let lastComponents: ConfidenceComponent[] = [];

  for (const o of obs) {
    const { raw, components } = rawComposite(o);
    if (ema === null) {
      ema = raw;
    } else {
      const carry = Math.pow(0.5, daysBetween(prevAsOf as string, o.asOf) / halfLife);
      ema = raw + (ema - raw) * carry;
    }
    prevAsOf = o.asOf;
    lastRaw = raw;
    lastComponents = components;
  }

  return {
    snapshotId,
    value: {
      score: Math.round(ema as number),
      rawScore: Math.round(lastRaw),
      components: lastComponents,
      observations: obs.length,
      firstObservedAt: obs[0].asOf,
    },
    source: VERSIONS.confidence.source,
    version: VERSIONS.confidence.version,
    inputs: obs.map((o) => o.snapshotId), // the snapshot history it smoothed over
  };
}

// Adapter: one stored/computed snapshot → one observation (mirrors
// materialChange's snapshotSummary).
export function confidenceObservation(
  snap: StrategicSnapshot,
): ConfidenceObservation {
  return {
    snapshotId: snap.snapshotId,
    asOf: snap.asOf,
    runwayMonths: snap.fire.value.runwayMonths,
    monthlySpendEUR: snap.fire.value.monthlySpendEUR,
    safeMonthlySpendEUR: snap.fire.value.safeMonthlySpendEUR,
    dataQuality: snap.dataQuality.value.score,
  };
}
