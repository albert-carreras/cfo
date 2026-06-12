import { desc } from "drizzle-orm";
import { db } from "./db";
import { checks } from "./db/schema";

// Repeat-check detection: the home page records every look and shows
// when the previous one was. Append-only, like everything else (principle #4).

export type CheckRow = typeof checks.$inferSelect;

// Returns the PREVIOUS check (the latest row before this look) and records the
// current one. One round trip each; a double refresh honestly says "you last
// checked seconds ago" — that's the feature, not a bug.
export async function recordCheck(statusAtCheck: string): Promise<CheckRow | null> {
  const [previous] = await db
    .select()
    .from(checks)
    .orderBy(desc(checks.checkedAt), desc(checks.id))
    .limit(1);
  await db.insert(checks).values({ statusAtCheck });
  return previous ?? null;
}
