import { runDailyUpdate } from "@/server/feed/update";
import { failureNotification, sendNotification } from "@/server/notify";

// The daily feed (prices + FX + today's snapshot), hit by the cron sidecar.
// Safe to re-run: price/FX rows upsert on (key, date). GET so plain wget works.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await runDailyUpdate());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A symbol failing shows on the overview; this is the whole run dying.
    await sendNotification(failureNotification(message));
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export const POST = GET;
