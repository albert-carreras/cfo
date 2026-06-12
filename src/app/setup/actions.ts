"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { commitSetup, SetupInputError } from "@/server/setup";
import { runDailyUpdate } from "@/server/feed/update";

export type SetupResult =
  | { ok: true; snapshotId: string }
  | { ok: false; error: string };

// The wizard's single commit: validates, refuses on a non-empty database,
// writes the whole baseline in one transaction and promotes the first
// strategic snapshot. The price feed is kicked best-effort afterwards — a
// failure there surfaces honestly as missing prices in data quality, never
// as a failed setup.
export async function submitSetup(input: unknown): Promise<SetupResult> {
  let snapshotId: string;
  try {
    const result = await commitSetup(input);
    snapshotId = result.snapshotId;
  } catch (err) {
    if (err instanceof SetupInputError) {
      return { ok: false, error: err.message };
    }
    if (err instanceof z.ZodError) {
      return {
        ok: false,
        error: err.issues
          .map((issue) =>
            issue.path.length > 0
              ? `${issue.path.join(".")}: ${issue.message}`
              : issue.message,
          )
          .join("; "),
      };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "setup failed",
    };
  }

  try {
    await runDailyUpdate();
  } catch {
    // Best-effort: missing prices show up in data_quality, not as an error.
  }

  revalidatePath("/");
  return { ok: true, snapshotId };
}
