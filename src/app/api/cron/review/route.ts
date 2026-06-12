import { runMonthlyReview } from "@/server/review";

// The scheduled monthly review. Hit by the cron sidecar on the 1st;
// safe to re-run — one review per month, a second hit is a no-op. A missing
// key / provider trouble degrade it to the deterministic floor instead of
// failing, so the monthly cadence always holds. Tailnet-only;
// GET so plain `wget` works.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await runMonthlyReview();
    return Response.json(result, { status: result.ok ? 200 : 500 });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export const POST = GET;
