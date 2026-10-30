import { asc, desc, sql } from "drizzle-orm";
import { db, type Database } from "./db";
import { snapshots } from "./db/schema";
import { snapshotStatus, type StrategicSnapshot } from "@/calc/snapshot";

// One computed snapshot per day: the daily feed and every change upsert the
// same row. Older rows (the previous "strategic"/"internal" split) stay as
// history; the chart reads both.

type SnapshotDatabase = Pick<Database, "insert" | "select">;

export async function persistSnapshot(
  snap: StrategicSnapshot,
  options: { computedAt: Date; database?: SnapshotDatabase },
) {
  const database = options.database ?? db;
  const values = {
    id: snap.snapshotId,
    kind: "internal" as const,
    status: snapshotStatus(snap),
    result: snap,
    asOf: snap.asOf,
    dedupeKey: `internal:${snap.asOf}`,
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

// Net worth over time, one point per day (the latest row of that day). Reads
// a single JSON field so years of snapshots stay cheap.
export async function netWorthSeries(database: SnapshotDatabase = db) {
  const rows = await database
    .select({
      asOf: snapshots.asOf,
      computedAt: snapshots.computedAt,
      totalEUR: sql<string | null>`${snapshots.result}->'netWorth'->'value'->>'totalEUR'`,
    })
    .from(snapshots)
    .orderBy(asc(snapshots.asOf), desc(snapshots.computedAt));
  const byDay = new Map<string, number>();
  for (const row of rows) {
    if (row.totalEUR === null || byDay.has(row.asOf)) continue;
    byDay.set(row.asOf, Number(row.totalEUR));
  }
  return [...byDay].map(([asOf, totalEUR]) => ({ asOf, totalEUR }));
}
