import { sql } from "drizzle-orm";
import { db } from "@/server/db";

// Readiness probe for the deploy healthcheck: 200 only once the app can reach
// the database. Never cached.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
