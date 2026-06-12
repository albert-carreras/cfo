import type { CalcResult } from "./types";
import { VERSIONS } from "./config/versions";
import { CADENCE_MAX_DAYS, type Cadence } from "./config/cadence";

// Completeness + freshness, scored against the expected-cadence config. This is
// the "do we know enough?" signal — kept separate from FIRE confidence. An input
// past its cadence (or never entered) counts as missing/stale; a missing
// REQUIRED input is what drives the Data-stale status. Soft advisory FLAGS
// (e.g. "your spend assumption looks off vs the logged spend") lower
// the score like a missing input but are never required — they can never flip
// the home to Data stale. Pure: `asOf` is passed in.

export type FreshnessInput = {
  id: string;
  sourceIds?: string[];
  label: string;
  lastUpdated: string | null; // YYYY-MM-DD, or null if never entered
  cadence: Cadence;
  required: boolean;
};

export type SoftFlag = {
  id: string;
  sourceIds?: string[];
  label: string;
};

export type DataQualityValue = {
  score: "Good" | "Partial" | "Poor";
  missing: string[]; // labels past cadence or never entered
  missingRequired: string[]; // subset that are required (drives Data stale)
  flags: string[]; // soft advisory flags — never required, never Data stale
  stalestInputDays: number | null;
};

function daysBetween(from: string, to: string): number {
  const ms = Date.parse(to) - Date.parse(from);
  return Math.floor(ms / 86_400_000);
}

export function dataQuality(args: {
  snapshotId: string;
  asOf: string;
  inputs: FreshnessInput[];
  flags?: SoftFlag[];
}): CalcResult<DataQualityValue> {
  const { snapshotId, asOf, inputs, flags = [] } = args;

  const missing: string[] = [];
  const missingRequired: string[] = [];
  let stalest: number | null = null;

  for (const input of inputs) {
    if (input.lastUpdated === null) {
      missing.push(input.label);
      if (input.required) missingRequired.push(input.label);
      continue;
    }
    const age = daysBetween(input.lastUpdated, asOf);
    if (stalest === null || age > stalest) stalest = age;
    if (age > CADENCE_MAX_DAYS[input.cadence]) {
      missing.push(input.label);
      if (input.required) missingRequired.push(input.label);
    }
  }

  // Flags can downgrade Good → Partial, never to Poor: a Poor score flips the
  // home to Data stale, and a soft flag is structurally barred from doing that.
  const base: DataQualityValue["score"] =
    missing.length === 0 ? "Good" : missing.length <= 2 ? "Partial" : "Poor";
  const score: DataQualityValue["score"] =
    base === "Good" && flags.length > 0 ? "Partial" : base;

  return {
    snapshotId,
    value: {
      score,
      missing,
      missingRequired,
      flags: flags.map((flag) => flag.label),
      stalestInputDays: stalest,
    },
    source: VERSIONS.dataQuality.source,
    version: VERSIONS.dataQuality.version,
    inputs: [
      ...new Set(
        [...inputs, ...flags].flatMap((input) =>
          input.sourceIds?.length ? input.sourceIds : [input.id],
        ),
      ),
    ],
  };
}
