import type { CalcResult } from "./types";
import { VERSIONS } from "./config/versions";

// Age is Calculated, not Verified: the birthDate assumption is the Verified
// fact, and this versioned calculator derives age from it for a given asOf —
// pure date math, no clock, full provenance (the assumption row id).

export type ProfileValue = {
  birthDate: string | null; // the Verified input, echoed for display
  ageYears: number | null; // null = no birthDate recorded
};

// Completed years at `asOf`. A Feb-29 birthday simply hasn't occurred yet on
// Feb 28 of any year (the (month, day) comparison handles it — no crash, no
// special case).
export function ageAt(birthDateISO: string, asOfISO: string): number {
  const [by, bm, bd] = birthDateISO.split("-").map(Number);
  const [y, m, d] = asOfISO.split("-").map(Number);
  const hadBirthday = m > bm || (m === bm && d >= bd);
  return y - by - (hadBirthday ? 0 : 1);
}

export function profile(args: {
  snapshotId: string;
  asOf: string;
  birthDate: { id: string; date: string } | null;
}): CalcResult<ProfileValue> {
  const { snapshotId, asOf, birthDate } = args;
  return {
    snapshotId,
    value: {
      birthDate: birthDate?.date ?? null,
      ageYears: birthDate ? ageAt(birthDate.date, asOf) : null,
    },
    source: VERSIONS.profile.source,
    version: VERSIONS.profile.version,
    inputs: birthDate ? [birthDate.id] : [],
  };
}
