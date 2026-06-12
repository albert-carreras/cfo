// The spine. Every calculator returns this — typed numbers tagged with the
// snapshot they belong to, the calc that produced them, its version, and the
// ids of every fact/movement/price it used (provenance).
export type CalcResult<T> = {
  snapshotId: string;
  value: T;
  source: string; // e.g. "netWorth.v1"
  version: string; // e.g. "netWorth.2026.0"
  inputs: string[]; // ids of the facts/movements/prices it used
};
