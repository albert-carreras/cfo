// Every deterministic result carries an explicit calculator and configuration
// version. Bump a version deliberately when a formula or threshold changes.
export const VERSIONS = {
  valuation: { source: "valuation.v1", version: "valuation.2026.1" },
  netWorth: { source: "netWorth.v2", version: "netWorth.2026.3" },
  fire: { source: "fire.v2", version: "fire.2026.4" },
  dataQuality: { source: "dataQuality.v2", version: "dataQuality.2026.4" },
  status: { source: "status.v1", version: "status.2026.1" },
  materialChange: {
    source: "materialChange.v1",
    version: "materialChange.2026.1",
  },
  concentration: {
    source: "concentration.v1",
    version: "concentration.2026.1",
  },
} as const;
