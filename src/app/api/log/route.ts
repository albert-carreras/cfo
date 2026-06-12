import { z } from "zod";
import {
  appendMovement,
  appendTransfer,
  logMonthlySpend,
  logRevaluation,
  monthlySpendInputSchema,
  movementInputSchema,
  revaluationInputSchema,
  transferInputSchema,
  QuickLogInputError,
} from "@/server/quicklog";

// Programmatic entrypoint to the quick-log seam. the parser can post here
// after turning free text into a structured proposal.
const bodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("movement"), data: movementInputSchema }),
  z.object({ kind: z.literal("monthlySpend"), data: monthlySpendInputSchema }),
  z.object({ kind: z.literal("transfer"), data: transferInputSchema }),
  z.object({ kind: z.literal("revaluation"), data: revaluationInputSchema }),
]);

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: z.treeifyError(parsed.error) }, { status: 400 });
  }

  try {
    switch (parsed.data.kind) {
      case "movement": {
        const row = await appendMovement(parsed.data.data);
        return Response.json({ ok: true, id: row.id });
      }
      case "monthlySpend": {
        const row = await logMonthlySpend(parsed.data.data);
        return Response.json({ ok: true, id: row.id });
      }
      case "transfer": {
        const { transferGroupId, legs } = await appendTransfer(parsed.data.data);
        return Response.json({
          ok: true,
          transferGroupId,
          ids: legs.map((leg) => leg.id),
        });
      }
      case "revaluation": {
        const row = await logRevaluation(parsed.data.data);
        return Response.json({ ok: true, id: row.id });
      }
    }
  } catch (error) {
    if (error instanceof QuickLogInputError || error instanceof z.ZodError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
