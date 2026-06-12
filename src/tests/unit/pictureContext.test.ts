import { describe, expect, it } from "vitest";
import { buildPictureContext } from "@/ai/pictureContext";
import type { AskAssumption } from "@/ai/context";
import { picture } from "@/calc/picture";
import { computeSnapshot } from "@/calc/snapshot";
import { profile } from "@/calc/profile";
import { facts, fixture, FIXTURE_AS_OF } from "../fixtures";

// The picture context: the Ask boundary plus the picture.v1 ratio metrics.
// The no-raw-dump guarantee is inherited from buildAskContext (tested there);
// here we check what the picture adds.

const snapshot = computeSnapshot({
  snapshotId: "snap_pic",
  asOf: FIXTURE_AS_OF,
  reviewDue: false,
  facts,
});

const derived = picture({
  snapshotId: "snap_pic",
  netWorth: snapshot.netWorth.value,
  fire: snapshot.fire.value,
  inputs: [snapshot.netWorth.source, snapshot.fire.source],
});

const assumptions: AskAssumption[] = fixture.assumptions.map((a) => ({
  id: a.id,
  key: a.key,
  value: a.value,
  dateValue: a.dateValue ?? null,
  source: a.source,
}));

const ctx = buildPictureContext({
  snapshot,
  profile: profile({
    snapshotId: "snap_pic",
    asOf: FIXTURE_AS_OF,
    birthDate: { id: "assum_birth", date: "1988-07-14" },
  }),
  assumptions,
  derived,
});

describe("buildPictureContext", () => {
  it("appends the picture ratio metrics with the calculator's provenance", () => {
    const liquid = ctx.metrics.find((m) => m.id === "picture.liquidSharePct");
    expect(liquid).toBeTruthy();
    expect(liquid!.value).toBe(`${derived.value.liquidSharePct}%`);
    expect(liquid!.citations).toEqual(["snap_pic", "picture.v1"]);
    const runway = ctx.metrics.find((m) => m.id === "picture.runwayYearsCoarse");
    expect(runway!.value).toBe(`${derived.value.runwayYearsCoarse} years`);
  });

  it("extends the citation whitelist with picture.v1 and labels it", () => {
    expect(ctx.allowedCitations).toContain("picture.v1");
    expect(ctx.citationLabels["picture.v1"]).toContain("picture.2026.0");
  });

  it("serializes the picture metrics into the model input", () => {
    const input = JSON.parse(ctx.input) as {
      metrics: { id: string }[];
      allowedCitations: string[];
    };
    expect(input.metrics.some((m) => m.id === "picture.spendHeadroomPct")).toBe(true);
    expect(input.allowedCitations).toContain("picture.v1");
  });

  it("keeps the base Ask metrics and swaps in the picture brief", () => {
    expect(ctx.metrics.some((m) => m.id === "fire.runwayYears")).toBe(true);
    expect(ctx.instructions).toContain("the picture");
    expect(ctx.instructions).toContain("judgment");
    expect(ctx.instructions).toContain("{{metric-id}}");
    expect(ctx.instructions).toContain("no recommendations");
  });
});
