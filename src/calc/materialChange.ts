import { dec, money, type Money } from "./money";
import type { CalcResult } from "./types";
import { VERSIONS } from "./config/versions";
import { MATERIAL_CHANGE_THRESHOLDS } from "./config/thresholds";
import type { StatusLevel } from "./status";
import type { StrategicSnapshot } from "./snapshot";

// The firewall between daily internal updates and the calm monthly surface:
// compares the CURRENT computed state against the LAST strategic (user-visible)
// snapshot and decides, deterministically, whether anything material changed.
// Material ⇒ the daily job promotes a new strategic snapshot off-cycle (and the
// home page says so); otherwise the surface stays put — "No material change."

export type SnapshotSummary = {
  asOf: string;
  totalNetWorthEUR: Money;
  // The liquid+investable pile — property equity dilutes the total-
  // net-worth move, so an equity-only crash gets its own threshold. Optional:
  // older stored summaries lack it, and the check skips quietly.
  fireCountedEUR?: Money;
  runwayMonths: number | null;
  status: StatusLevel;
};

export type MaterialChangeKind =
  | "first_snapshot" // no strategic snapshot exists yet
  | "net_worth_move" // net worth moved ≥ the threshold %
  | "fire_counted_move" // the liquid+investable pile moved ≥ its threshold %
  | "runway_floor_crossed" // runway fell below the action floor
  | "status_worsened"; // status degraded to action_recommended / urgent

export type MaterialChangeValue = {
  material: boolean;
  changes: { kind: MaterialChangeKind; detail: string }[];
  netWorthDeltaPct: Money | null; // signed % move vs the last strategic snapshot
  comparedTo: string | null; // asOf of the strategic snapshot compared against
};

// How alarming each status is; only a move INTO the action band is material
// (data_stale/review_soon are cadence concerns, handled by their own flows).
const SEVERITY: Record<StatusLevel, number> = {
  stable: 0,
  review_soon: 1,
  data_stale: 2,
  action_recommended: 3,
  urgent: 4,
};

export function snapshotSummary(snap: StrategicSnapshot): SnapshotSummary {
  return {
    asOf: snap.asOf,
    totalNetWorthEUR: snap.netWorth.value.totalEUR,
    fireCountedEUR: snap.netWorth.value.fireCountedEUR,
    runwayMonths: snap.fire.value.runwayMonths,
    status: snap.status.value.status,
  };
}

export function materialChange(args: {
  snapshotId: string;
  previous: SnapshotSummary | null;
  current: SnapshotSummary;
}): CalcResult<MaterialChangeValue> {
  const { snapshotId, previous, current } = args;
  const t = MATERIAL_CHANGE_THRESHOLDS;
  const changes: MaterialChangeValue["changes"] = [];
  let deltaPct: Money | null = null;

  if (previous === null) {
    changes.push({
      kind: "first_snapshot",
      detail: "No strategic snapshot exists yet.",
    });
  } else {
    const prevNw = dec(previous.totalNetWorthEUR);
    const currNw = dec(current.totalNetWorthEUR);
    if (!prevNw.isZero()) {
      const pct = currNw.minus(prevNw).dividedBy(prevNw.abs()).times(100);
      deltaPct = pct.toFixed(2);
      if (pct.abs().greaterThanOrEqualTo(t.netWorthDeltaPct)) {
        changes.push({
          kind: "net_worth_move",
          detail: `Net worth moved ${pct.toFixed(1)}% (${money(prevNw)} → ${money(currNw)}) since ${previous.asOf}.`,
        });
      }
    }

    // The liquid pile gets its own threshold: a 12% equity crash
    // inside a RE-heavy portfolio can sit under the total-net-worth threshold
    // on exactly the event the surface should move on. Skipped when either
    // side predates the field (stored summaries without it).
    if (
      previous.fireCountedEUR !== undefined &&
      current.fireCountedEUR !== undefined
    ) {
      const prevFire = dec(previous.fireCountedEUR);
      const currFire = dec(current.fireCountedEUR);
      if (!prevFire.isZero()) {
        const pct = currFire.minus(prevFire).dividedBy(prevFire.abs()).times(100);
        if (pct.abs().greaterThanOrEqualTo(t.fireCountedDeltaPct)) {
          changes.push({
            kind: "fire_counted_move",
            detail: `Liquid + investable moved ${pct.toFixed(1)}% (${money(prevFire)} → ${money(currFire)}) since ${previous.asOf}.`,
          });
        }
      }
    }

    if (
      previous.runwayMonths !== null &&
      current.runwayMonths !== null &&
      previous.runwayMonths >= t.runwayFloorMonths &&
      current.runwayMonths < t.runwayFloorMonths
    ) {
      changes.push({
        kind: "runway_floor_crossed",
        detail: `Runway fell below the ${t.runwayFloorMonths}-month floor (${previous.runwayMonths} → ${current.runwayMonths} months).`,
      });
    }

    if (
      SEVERITY[current.status] > SEVERITY[previous.status] &&
      SEVERITY[current.status] >= SEVERITY.action_recommended
    ) {
      changes.push({
        kind: "status_worsened",
        detail: `Status worsened: ${previous.status} → ${current.status}.`,
      });
    }
  }

  return {
    snapshotId,
    value: {
      material: changes.length > 0,
      changes,
      netWorthDeltaPct: deltaPct,
      comparedTo: previous?.asOf ?? null,
    },
    source: VERSIONS.materialChange.source,
    version: VERSIONS.materialChange.version,
    inputs: [], // a meta-calc over two snapshots; provenance lives in their ids
  };
}
