"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runPicture } from "@/server/picture";

// Mirrors /ask's pattern: a thin action over the server seam. The refresh
// regenerates the narrative against the latest STORED strategic snapshot —
// it never promotes one.

export async function refreshPicture() {
  const result = await runPicture({ force: true });
  revalidatePath("/picture");
  if (!result.ok) redirect(`/picture?err=${result.reason}`);
  redirect("/picture");
}
