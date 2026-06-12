import { desc, eq, sql } from "drizzle-orm";
import { db, type Database } from "./db";
import { snapshots } from "./db/schema";
import { STATUS_THRESHOLDS } from "@/calc/config/thresholds";
import type { StrategicSnapshot } from "@/calc/snapshot";

// Snapshot history. Two kinds (see docs/data-model.md): `internal` — written by
// the daily price/FX job so a running history exists for material-change
// detection and the confidence score — and `strategic` — the monthly
// user-visible one, promoted off-cycle only on material change.

export type SnapshotKind = "strategic" | "internal";
type SnapshotDatabase = Pick<Database, "insert" | "select">;

export async function latestSnapshot(
  kind: SnapshotKind,
  database: SnapshotDatabase = db,
) {
  const [row] = await database
    .select()
    .from(snapshots)
    .where(eq(snapshots.kind, kind))
    .orderBy(
      desc(snapshots.computedAt),
      desc(snapshots.createdAt),
      desc(snapshots.id),
    )
    .limit(1);
  return row ?? null;
}

export async function latestStrategicSnapshot(database: SnapshotDatabase = db) {
  return latestSnapshot("strategic", database);
}

// Newest-first history of one kind. The reviews page lists `strategic` rows;
// the confidence score consumes the `internal` daily history (oldest-first —
// callers reverse as needed). Bounded so a years-long history stays cheap.
export async function listSnapshots(
  kind: SnapshotKind,
  limit: number,
  database: SnapshotDatabase = db,
) {
  return database
    .select()
    .from(snapshots)
    .where(eq(snapshots.kind, kind))
    .orderBy(
      desc(snapshots.computedAt),
      desc(snapshots.createdAt),
      desc(snapshots.id),
    )
    .limit(limit);
}

export async function persistSnapshot(
  kind: SnapshotKind,
  snap: StrategicSnapshot,
  options: {
    computedAt: Date;
    dedupeKey: string;
    database?: SnapshotDatabase;
  },
) {
  const database = options.database ?? db;
  const values = {
    id: snap.snapshotId,
    kind,
    status: snap.status.value.status,
    result: snap,
    asOf: snap.asOf,
    dedupeKey: options.dedupeKey,
    computedAt: options.computedAt,
  };
  const [row] = await database
    .insert(snapshots)
    .values(values)
    .onConflictDoUpdate({
      target: snapshots.dedupeKey,
      targetWhere: sql`${snapshots.dedupeKey} is not null`,
      set: values,
    })
    .returning();
  return row;
}

// The stored jsonb is exactly the StrategicSnapshot the job computed.
export function storedSnapshotResult(row: {
  result: unknown;
}): StrategicSnapshot {
  return row.result as StrategicSnapshot;
}

// Shared review-due rule (home page + daily job): a strategic snapshot older
// than the threshold means a scheduled review is due.
export function isReviewDue(
  lastStrategicComputedAt: Date | null,
  asOf: string,
): boolean {
  if (lastStrategicComputedAt === null) return false;
  const last = lastStrategicComputedAt.toISOString().slice(0, 10);
  const days = Math.floor((Date.parse(asOf) - Date.parse(last)) / 86_400_000);
  return days > STATUS_THRESHOLDS.reviewDueDays;
}
