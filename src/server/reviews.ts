import { desc, eq } from "drizzle-orm";
import { db, type Database } from "./db";
import { reviews } from "./db/schema";

// Monthly review rows. Append-only: one row per month, inserted by
// the cron-driven runMonthlyReview and never edited — a redo would be a new
// month, not a rewrite.

export type ReviewRow = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;
type ReviewsDatabase = Pick<Database, "insert" | "select">;

export async function saveReview(
  row: NewReview,
  database: ReviewsDatabase = db,
): Promise<ReviewRow> {
  const [saved] = await database.insert(reviews).values(row).returning();
  return saved;
}

export async function reviewForMonth(
  month: string,
  database: ReviewsDatabase = db,
): Promise<ReviewRow | null> {
  const [row] = await database
    .select()
    .from(reviews)
    .where(eq(reviews.month, month))
    .limit(1);
  return row ?? null;
}

export async function latestReview(
  database: ReviewsDatabase = db,
): Promise<ReviewRow | null> {
  const [row] = await database
    .select()
    .from(reviews)
    .orderBy(desc(reviews.month))
    .limit(1);
  return row ?? null;
}

export async function listReviews(
  limit: number,
  database: ReviewsDatabase = db,
): Promise<ReviewRow[]> {
  return database
    .select()
    .from(reviews)
    .orderBy(desc(reviews.month))
    .limit(limit);
}
