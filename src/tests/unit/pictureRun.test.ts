import { describe, expect, it } from "vitest";
import { getPictureClient } from "@/ai";
import { createFakePictureClient } from "@/ai/fake";
import type { PictureNarrative } from "@/ai/types";
import type { PictureValue } from "@/calc/picture";
import { computeSnapshot } from "@/calc/snapshot";
import type { CalcResult } from "@/calc/types";
import type { NewPicture } from "@/server/pictures";
import { runPicture, type PictureDeps } from "@/server/picture";
import { facts, fixture, FIXTURE_AS_OF } from "../fixtures";

// The picture orchestration seam, end to end with no DB and no network. The
// load-bearing property mirrors the review's: the page NEVER depends on the
// provider — a missing key, provider throws and validation
// failures all land a deterministic-scope row with the floor pinned on it.

const snapshot = computeSnapshot({
  snapshotId: "snap_pic",
  asOf: FIXTURE_AS_OF,
  reviewDue: false,
  facts,
});

function makeDeps(overrides: Partial<PictureDeps> = {}) {
  const saved: NewPicture[] = [];
  const deps: PictureDeps = {
    apiKey: () => "sk-test",
    latestSnapshotRow: async () => ({ id: "snap_pic", result: snapshot }),
    assumptionRows: async () =>
      fixture.assumptions.map((a) => ({
        id: a.id,
        key: a.key,
        value: a.value,
        dateValue: a.dateValue ?? null,
        source: a.source,
      })),
    pictureForSnapshot: async () => null,
    latestPictureRow: async () => null,
    clientFor: () => ({ ok: true, client: createFakePictureClient() }),
    savePicture: async (row) => {
      saved.push(row);
      return { id: "pic_1" };
    },
    today: () => "2026-06-11",
    ...overrides,
  };
  return { deps, saved };
}

describe("runPicture", () => {
  it("runs full: validates, persists narrative + pinned context, summary and derived floor", async () => {
    const { deps, saved } = makeDeps();
    const result = await runPicture({ force: false }, deps);

    expect(result).toMatchObject({
      ok: true,
      skipped: false,
      scope: "full",
      llmError: null,
      snapshotId: "snap_pic",
    });
    expect(saved).toHaveLength(1);
    const row = saved[0];
    expect(row.scope).toBe("full");
    expect(row.model).toBe("fake");
    expect((row.narrative as PictureNarrative).sections.length).toBeGreaterThan(0);
    expect(row.context).toBeTruthy();
    expect(row.summary).toMatchObject({ asOf: FIXTURE_AS_OF });
    const derived = row.derived as CalcResult<PictureValue>;
    expect(derived.source).toBe("picture.v1");
    expect(derived.value.liquidSharePct).not.toBeNull();
  });

  it("skips when this snapshot already has a picture and force is off", async () => {
    const { deps, saved } = makeDeps({
      pictureForSnapshot: async () => ({ id: "pic_existing" }),
    });
    expect(await runPicture({ force: false }, deps)).toEqual({
      ok: true,
      skipped: true,
      snapshotId: "snap_pic",
    });
    expect(saved).toHaveLength(0);
  });

  // The calm firewall: user intents promote a NEW same-day snapshot row, so
  // the per-snapshot dedupe alone would call the provider on every quick log.
  // The latest picture's pinned summary gates regeneration on material change
  // or a month roll — the same rules the daily feed's promotion uses.
  const pinnedSummary = {
    asOf: FIXTURE_AS_OF,
    totalNetWorthEUR: snapshot.netWorth.value.totalEUR,
    fireCountedEUR: snapshot.netWorth.value.fireCountedEUR,
    runwayMonths: snapshot.fire.value.runwayMonths,
    status: snapshot.status.value.status,
  };

  it("skips an immaterial new snapshot — routine logs never spend a provider call", async () => {
    const { deps, saved } = makeDeps({
      latestPictureRow: async () => ({ summary: pinnedSummary }),
    });
    expect(await runPicture({ force: false }, deps)).toEqual({
      ok: true,
      skipped: true,
      snapshotId: "snap_pic",
    });
    expect(saved).toHaveLength(0);
  });

  it("regenerates when the pile moved materially since the pictured summary", async () => {
    const { deps, saved } = makeDeps({
      latestPictureRow: async () => ({
        summary: { ...pinnedSummary, totalNetWorthEUR: "700000.00", fireCountedEUR: "250000.00" },
      }),
    });
    const result = await runPicture({ force: false }, deps);
    expect(result).toMatchObject({ ok: true, skipped: false, scope: "full" });
    expect(saved).toHaveLength(1);
  });

  it("regenerates when the pictured month rolled, even without a material move", async () => {
    const { deps, saved } = makeDeps({
      latestPictureRow: async () => ({
        summary: { ...pinnedSummary, asOf: "2026-05-31" },
      }),
    });
    const result = await runPicture({ force: false }, deps);
    expect(result).toMatchObject({ ok: true, skipped: false, scope: "full" });
    expect(saved).toHaveLength(1);
  });

  it("force bypasses the material-change gate too", async () => {
    const { deps, saved } = makeDeps({
      latestPictureRow: async () => ({ summary: pinnedSummary }),
    });
    const result = await runPicture({ force: true }, deps);
    expect(result).toMatchObject({ ok: true, skipped: false });
    expect(saved).toHaveLength(1);
  });

  it("force appends a new row even when one exists (latest wins)", async () => {
    const { deps, saved } = makeDeps({
      pictureForSnapshot: async () => ({ id: "pic_existing" }),
    });
    const result = await runPicture({ force: true }, deps);
    expect(result).toMatchObject({ ok: true, skipped: false, scope: "full" });
    expect(saved).toHaveLength(1);
  });

  it("a missing key degrades to deterministic without touching provider code", async () => {
    const { deps, saved } = makeDeps({
      apiKey: () => undefined,
      clientFor: getPictureClient, // the real factory: the key gate resolves first
    });
    const result = await runPicture({ force: false }, deps);
    expect(result).toMatchObject({ ok: true, scope: "deterministic", llmError: "no-key" });
    expect(saved[0].scope).toBe("deterministic");
    expect(saved[0].narrative).toBeUndefined();
    expect(saved[0].derived).toBeTruthy(); // the floor is pinned anyway
  });

  it("a provider throw degrades to deterministic with the reason", async () => {
    const { deps } = makeDeps({
      clientFor: () => ({
        ok: true,
        client: {
          picture: async () => {
            throw new Error("HTTP 500");
          },
        },
      }),
    });
    expect(await runPicture({ force: false }, deps)).toMatchObject({
      scope: "deterministic",
      llmError: "provider-error: HTTP 500",
    });
  });

  it("a narrative that dies in validation degrades to deterministic", async () => {
    const fabricated: PictureNarrative = {
      sections: [
        {
          heading: "Made up",
          statements: [
            { label: "calculated", text: "You hold 12 bitcoins.", citations: [] },
          ],
        },
      ],
    };
    const { deps } = makeDeps({
      clientFor: () => ({ ok: true, client: createFakePictureClient(fabricated) }),
    });
    expect(await runPicture({ force: false }, deps)).toMatchObject({
      scope: "deterministic",
      llmError: "empty-after-validation",
    });
  });

  it("fails honestly when no strategic snapshot exists yet", async () => {
    const { deps } = makeDeps({ latestSnapshotRow: async () => null });
    expect(await runPicture({ force: false }, deps)).toEqual({
      ok: false,
      reason: "no-snapshot",
    });
  });
});
