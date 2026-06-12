import { dec } from "@/calc/money";

// Macro-series provider: the ECB Data Portal SDMX API (free, no key) — the
// same institution as the FX feed, a different endpoint. Two series feed the
// auto-updated assumptions:
//   inflation     ← HICP/M.ES.N.000000.4D0.ANR  (Spain HICP, annual rate, %)
//   interestRate  ← FM/B.U2.EUR.4F.KR.DFR.LEV   (ECB deposit facility rate, %)
// Parsers are pure functions so correctness is Vitest-tested without network.

export const ECB_DATA_API = "https://data-api.ecb.europa.eu/service/data";

// key → { flow, seriesKey }. The DFR series is "date of changes": announced
// future rate changes appear as future-dated observations, so we always pick
// the latest observation NOT after asOf, never blindly the last row.
export const ECB_ASSUMPTION_SERIES: Record<
  "inflation" | "interestRate",
  { flow: string; seriesKey: string; lastN: number }
> = {
  inflation: { flow: "HICP", seriesKey: "M.ES.N.000000.4D0.ANR", lastN: 2 },
  interestRate: { flow: "FM", seriesKey: "B.U2.EUR.4F.KR.DFR.LEV", lastN: 4 },
};

export type SeriesObservation = { period: string; value: string };

// SDMX `csvdata`: a header row naming the columns, then one row per
// observation. TIME_PERIOD and OBS_VALUE sit before any free-text columns
// (which may contain quoted commas), so a naive comma split is safe for the
// indices we read — asserted by requiring both indices to parse cleanly.
export function parseSdmxCsv(csv: string): SeriesObservation[] {
  const lines = csv.split("\n").filter((line) => line.trim() !== "");
  if (lines.length < 2) throw new Error("SDMX CSV: no observation rows");
  const header = lines[0].split(",");
  const periodIdx = header.indexOf("TIME_PERIOD");
  const valueIdx = header.indexOf("OBS_VALUE");
  if (periodIdx === -1 || valueIdx === -1) {
    throw new Error("SDMX CSV: TIME_PERIOD / OBS_VALUE columns not found");
  }
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const period = cells[periodIdx];
    const value = cells[valueIdx];
    if (!/^\d{4}(-\d{2}){1,2}$/.test(period ?? "")) {
      throw new Error(`SDMX CSV: bad TIME_PERIOD "${period}"`);
    }
    if (!/^-?\d+(\.\d+)?$/.test(value ?? "")) {
      throw new Error(`SDMX CSV: bad OBS_VALUE "${value}" for ${period}`);
    }
    return { period, value };
  });
}

// The latest observation not after asOf — monthly periods (YYYY-MM) compare
// against the truncated asOf. Both series publish percent; the assumption
// stores a fraction (3.6 → "0.036").
export function latestAsFraction(
  observations: SeriesObservation[],
  asOf: string,
): { period: string; fraction: string } | null {
  let best: SeriesObservation | null = null;
  for (const obs of observations) {
    if (obs.period > asOf.slice(0, obs.period.length)) continue;
    if (best === null || obs.period > best.period) best = obs;
  }
  if (best === null) return null;
  return { period: best.period, fraction: dec(best.value).dividedBy(100).toString() };
}

// Once a month is enough for both series: refresh when the row is missing or
// its last review predates the current month. A manual edit therefore holds
// until the month rolls over — then the feed takes the row back.
export function assumptionFeedDue(
  lastReviewedAt: string | null,
  asOf: string,
): boolean {
  if (lastReviewedAt === null) return true;
  return lastReviewedAt.slice(0, 7) < asOf.slice(0, 7);
}

export async function fetchEcbSeries(
  key: keyof typeof ECB_ASSUMPTION_SERIES,
): Promise<SeriesObservation[]> {
  const { flow, seriesKey, lastN } = ECB_ASSUMPTION_SERIES[key];
  const url = `${ECB_DATA_API}/${flow}/${seriesKey}?lastNObservations=${lastN}&format=csvdata`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`ECB ${flow} fetch failed: HTTP ${res.status}`);
  return parseSdmxCsv(await res.text());
}
