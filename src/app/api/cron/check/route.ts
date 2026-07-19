import { runHealthCheck } from "@/server/healthCheck";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await runHealthCheck({ trigger: "scheduled" });
    return Response.json({ ok: true, id: result.id, verdict: result.verdict });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export const POST = GET;
