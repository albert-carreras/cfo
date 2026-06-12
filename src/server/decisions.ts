import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { DecisionThen } from "@/calc/decisionOutcome";
import { snapshotSummary } from "@/calc/materialChange";
import { db, type Database } from "./db";
import { decisions, snapshots } from "./db/schema";
import { storedSnapshotResult } from "./snapshots";

// The decision journal. Append-only in spirit: rows are inserted by
// the Ask flow and never edited — except the one guarded, once-only review
// path below. A changed mind is a new question, not an edit.

export type DecisionRow = typeof decisions.$inferSelect;
export type NewDecision = typeof decisions.$inferInsert;
type DecisionsDatabase = Pick<Database, "insert" | "select" | "update">;

export async function saveDecision(
  row: NewDecision,
  database: DecisionsDatabase = db,
): Promise<DecisionRow> {
  const [saved] = await database.insert(decisions).values(row).returning();
  return saved;
}

export async function listDecisions(
  limit: number,
  database: DecisionsDatabase = db,
): Promise<DecisionRow[]> {
  return database
    .select()
    .from(decisions)
    .orderBy(desc(decisions.createdAt), desc(decisions.id))
    .limit(limit);
}

export async function getDecision(
  id: string,
  database: DecisionsDatabase = db,
): Promise<DecisionRow | null> {
  const [row] = await database
    .select()
    .from(decisions)
    .where(eq(decisions.id, id))
    .limit(1);
  return row ?? null;
}

// The accountability loop's input: every journaled decision joined
// to its pinned snapshot, reduced to the summary the outcome calculator
// compares against the current one. Oldest first — the track record reads as
// a history. The pinned snapshot row survives the dedupe upsert (the FK
// cascades across the id rewrite), so "then" is always reconstructable.
export async function listDecisionsWithContext(
  database: DecisionsDatabase = db,
): Promise<DecisionThen[]> {
  const rows = await database
    .select({ decision: decisions, result: snapshots.result })
    .from(decisions)
    .innerJoin(snapshots, eq(decisions.snapshotId, snapshots.id))
    .orderBy(asc(decisions.createdAt), asc(decisions.id));
  return rows.map(({ decision, result }) => ({
    id: decision.id,
    question: decision.question,
    decidedOn: decision.createdAt.toISOString().slice(0, 10),
    reviewed: decision.reviewedAt !== null,
    chosenAction: decision.chosenAction,
    then: snapshotSummary(storedSnapshotResult({ result })),
  }));
}

// The manual-review unlock — atomic and once-only: the `reviewedAt is null`
// predicate makes a second review a no-op (returns null), never an overwrite.
export async function markReviewed(
  id: string,
  chosenAction: string | null,
  database: DecisionsDatabase = db,
): Promise<DecisionRow | null> {
  const [row] = await database
    .update(decisions)
    .set({ reviewedAt: new Date(), chosenAction })
    .where(and(eq(decisions.id, id), isNull(decisions.reviewedAt)))
    .returning();
  return row ?? null;
}
