import { getPictureClient, type PictureClientResult } from "@/ai";
import type { AskAssumption } from "@/ai/context";
import { buildPictureContext } from "@/ai/pictureContext";
import { validatePicture } from "@/ai/pictureSchema";
import type { PictureNarrative } from "@/ai/types";
import {
  materialChange,
  snapshotSummary,
  type SnapshotSummary,
} from "@/calc/materialChange";
import { picture } from "@/calc/picture";
import { profile } from "@/calc/profile";
import { db } from "./db";
import { assumptions } from "./db/schema";
import { getServerEnv } from "./env";
import {
  latestPicture,
  pictureForSnapshot,
  savePicture,
  type NewPicture,
} from "./pictures";
import { latestStrategicSnapshot, storedSnapshotResult } from "./snapshots";

// The picture orchestration — the standing reassurance narrative behind
// /picture. Mirrors review.ts: every dependency injectable, no throws to the
// caller, and the narrative NEVER fails because the provider is unavailable.
// A missing key, a provider error or a narrative that dies in
// validation all degrade to the deterministic floor (the picture.v1 ratios +
// the snapshot summary, pinned on the row in both scopes) — the page always
// has something calm and true to show.

export type PictureRunResult =
  | { ok: true; skipped: true; snapshotId: string }
  | {
      ok: true;
      skipped: false;
      pictureId: string;
      snapshotId: string;
      scope: "full" | "deterministic";
      llmError: string | null;
      droppedStatements: number;
    }
  | { ok: false; reason: "no-snapshot" };

export type PictureDeps = {
  apiKey: () => string | undefined;
  latestSnapshotRow: () => Promise<{ id: string; result: unknown } | null>;
  assumptionRows: () => Promise<AskAssumption[]>;
  pictureForSnapshot: (snapshotId: string) => Promise<{ id: string } | null>;
  latestPictureRow: () => Promise<{ summary: unknown } | null>;
  clientFor: (opts: { apiKey: string | undefined }) => PictureClientResult;
  savePicture: (row: NewPicture) => Promise<{ id: string }>;
  today: () => string;
};

async function loadAssumptionRows(): Promise<AskAssumption[]> {
  const rows = await db.select().from(assumptions);
  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    value: row.value,
    dateValue: row.dateValue,
    source: row.source,
  }));
}

const defaultDeps: PictureDeps = {
  apiKey: () => getServerEnv().OPENAI_API_KEY,
  latestSnapshotRow: () => latestStrategicSnapshot(),
  assumptionRows: loadAssumptionRows,
  pictureForSnapshot: (snapshotId) => pictureForSnapshot(snapshotId),
  latestPictureRow: () => latestPicture(),
  clientFor: getPictureClient,
  savePicture: (row) => savePicture(row),
  today: () => new Date().toISOString().slice(0, 10),
};

export async function runPicture(
  opts: { force: boolean },
  deps: PictureDeps = defaultDeps,
): Promise<PictureRunResult> {
  const row = await deps.latestSnapshotRow();
  if (!row) return { ok: false, reason: "no-snapshot" };
  const snapshot = storedSnapshotResult(row);

  // One narrative per promoted snapshot — the daily cron's re-hit is a no-op.
  // A manual refresh passes force and appends a new row (latest wins).
  if (!opts.force && (await deps.pictureForSnapshot(row.id)))
    return { ok: true, skipped: true, snapshotId: row.id };

  // The calm firewall: every user intent promotes a NEW same-day snapshot
  // row (the dedupe replaces the id), so the per-snapshot check above can't
  // bound provider calls on its own. Regenerate only when the picture would
  // actually change its story — the pictured month rolled, or the same
  // material-change rule the daily feed uses fires against the pinned
  // summary. force (the page button) bypasses.
  if (!opts.force) {
    const prev = await deps.latestPictureRow();
    if (prev) {
      const pinned = prev.summary as SnapshotSummary;
      const current = snapshotSummary(snapshot);
      const monthRolled = pinned.asOf.slice(0, 7) < current.asOf.slice(0, 7);
      const change = materialChange({
        snapshotId: snapshot.snapshotId,
        previous: pinned,
        current,
      });
      if (!monthRolled && !change.value.material)
        return { ok: true, skipped: true, snapshotId: row.id };
    }
  }

  // The deterministic floor, computed first and pinned in both scopes.
  const derived = picture({
    snapshotId: snapshot.snapshotId,
    netWorth: snapshot.netWorth.value,
    fire: snapshot.fire.value,
    inputs: [snapshot.netWorth.source, snapshot.fire.source],
  });
  const base: Omit<NewPicture, "scope"> = {
    snapshotId: row.id,
    summary: snapshotSummary(snapshot),
    derived,
  };

  const deterministic = async (llmError: string): Promise<PictureRunResult> => {
    const saved = await deps.savePicture({
      ...base,
      scope: "deterministic",
      llmError,
    });
    return {
      ok: true,
      skipped: false,
      pictureId: saved.id,
      snapshotId: row.id,
      scope: "deterministic",
      llmError,
      droppedStatements: 0,
    };
  };

  // A missing key resolves before any context is assembled.
  const clientResult = deps.clientFor({ apiKey: deps.apiKey() });
  if (!clientResult.ok) return deterministic(clientResult.reason);

  const assumptionRows = await deps.assumptionRows();
  const birth = assumptionRows.find(
    (a) => a.key === "birthDate" && a.dateValue !== null,
  );
  const ctx = buildPictureContext({
    snapshot,
    profile: profile({
      snapshotId: snapshot.snapshotId,
      asOf: deps.today(),
      birthDate: birth ? { id: birth.id, date: birth.dateValue as string } : null,
    }),
    assumptions: assumptionRows,
    derived,
  });

  let outcome: { narrative: PictureNarrative; model: string };
  try {
    outcome = await clientResult.client.picture(ctx);
  } catch (err) {
    return deterministic(
      `provider-error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const validated = validatePicture(outcome.narrative, ctx);
  if (!validated.ok) return deterministic(validated.reason);

  const saved = await deps.savePicture({
    ...base,
    scope: "full",
    narrative: validated.narrative,
    context: ctx,
    model: outcome.model,
  });

  return {
    ok: true,
    skipped: false,
    pictureId: saved.id,
    snapshotId: row.id,
    scope: "full",
    llmError: null,
    droppedStatements: validated.droppedStatements,
  };
}

export { latestPicture };
