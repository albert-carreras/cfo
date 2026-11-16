import { countVisit } from "@/server/visits";

// The page calls this once per load to bump the hit counter.
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return Response.json({ visits: await countVisit() });
  } catch {
    return Response.json({ visits: null }, { status: 503 });
  }
}
