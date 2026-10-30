import { runMonthlyDigest } from "@/server/digest";

// The monthly push: hit by the cron sidecar on the 1st, after the daily
// feed. Dedupes by month, so re-running never pings twice.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await runMonthlyDigest());
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export const POST = GET;
