import { runDailyUpdate } from "@/server/feed/update";
import { failureNotification, sendNotification } from "@/server/notify";

// The daily internal update (prices + FX + internal snapshot + the monthly /
// material-change strategic promotion). Hit by the cron sidecar once a day;
// safe to re-run — price/FX rows upsert on (key, asOf). Tailnet-only, like
// everything else, so no extra auth. GET so plain `wget`/`curl` works.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await runDailyUpdate();
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Partial failures notify from inside runDailyUpdate; this is the
    // whole-run-died ping ("your watch is broken", not "a symbol failed").
    await sendNotification(failureNotification(message));
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export const POST = GET;
