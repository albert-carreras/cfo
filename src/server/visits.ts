import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { settings } from "./db/schema";

// The hit counter: how many times the app has been opened (a full page load,
// not moving around inside it). Kept as one row in `settings`.

const KEY = "visits";

export async function readVisits(): Promise<number | null> {
  try {
    const [row] = await db.select().from(settings).where(eq(settings.key, KEY)).limit(1);
    return row ? Number(row.value) : 0;
  } catch {
    return null;
  }
}

// One more visit, atomically. Returns the new count.
export async function countVisit(): Promise<number> {
  const [row] = await db
    .insert(settings)
    .values({ key: KEY, value: "1" })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: sql`(${settings.value}::bigint + 1)::text`, updatedAt: new Date() },
    })
    .returning({ value: settings.value });
  return Number(row.value);
}
