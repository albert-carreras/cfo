import { createId } from "@paralleldrive/cuid2";
import { computeSnapshot } from "@/calc/snapshot";
import { db } from "./db";
import { dataUpdates } from "./db/schema";
import { loadFacts } from "./facts";
import { persistSnapshot } from "./snapshots";

// The shared tail of every write: one transaction per thing that happened,
// ending in one recomputed snapshot and one readable activity entry, so a
// snapshot can never capture a half-applied change.

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// A rejection the person can act on ("that account still holds €40"). The
// form shows the message instead of an error page.
export class RecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordError";
  }
}

export function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export async function intentTransaction<T>(
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(fn);
}

// Recompute today's snapshot from the transaction's view of the facts and
// store it as the day's row (the daily feed upserts the same row).
export async function recordSnapshot(database: DbTransaction, now: Date) {
  const asOf = utcDate(now);
  const bundle = await loadFacts(database, asOf);
  const snapshot = computeSnapshot({
    snapshotId: createId(),
    asOf,
    facts: bundle.facts,
  });
  await persistSnapshot(snapshot, { computedAt: now, database });
  return snapshot;
}

export type ActivityLine = { label: string; value: string };

// One human event in the activity log, tied to the snapshot it produced.
export async function finishChange(
  tx: DbTransaction,
  now: Date,
  entry: {
    asOf: string;
    kind: string;
    title: string;
    lines?: ActivityLine[];
    note?: string | null;
  },
) {
  const snapshot = await recordSnapshot(tx, now);
  await tx.insert(dataUpdates).values({
    asOf: entry.asOf,
    kind: entry.kind,
    title: entry.title,
    note: entry.note ?? null,
    changes: entry.lines ?? [],
    snapshotId: snapshot.snapshotId,
  });
  return snapshot;
}
