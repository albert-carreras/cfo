import { desc, eq } from "drizzle-orm";
import { db, type Database } from "./db";
import { pictures } from "./db/schema";

// Picture rows (the standing reassurance narrative). Append-only, latest
// wins: a refresh inserts a new row, never edits one — the page shows the
// most recent, the history stays evidence.

export type PictureRow = typeof pictures.$inferSelect;
export type NewPicture = typeof pictures.$inferInsert;
type PicturesDatabase = Pick<Database, "insert" | "select">;

export async function savePicture(
  row: NewPicture,
  database: PicturesDatabase = db,
): Promise<PictureRow> {
  const [saved] = await database.insert(pictures).values(row).returning();
  return saved;
}

export async function latestPicture(
  database: PicturesDatabase = db,
): Promise<PictureRow | null> {
  const [row] = await database
    .select()
    .from(pictures)
    .orderBy(desc(pictures.createdAt))
    .limit(1);
  return row ?? null;
}

export async function pictureForSnapshot(
  snapshotId: string,
  database: PicturesDatabase = db,
): Promise<PictureRow | null> {
  const [row] = await database
    .select()
    .from(pictures)
    .where(eq(pictures.snapshotId, snapshotId))
    .orderBy(desc(pictures.createdAt))
    .limit(1);
  return row ?? null;
}
