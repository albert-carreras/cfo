// Every deterministic result carries an explicit calculator and configuration
// version. Bump a version deliberately when a formula or threshold changes.
export const VERSIONS = {
  valuation: { source: "valuation.v1", version: "valuation.2026.1" },
  netWorth: { source: "netWorth.v3", version: "netWorth.2026.4" },
  fire: { source: "fire.v3", version: "fire.2026.5" },
  tax: { source: "tax.v1", version: "tax.2026.1" },
  attention: { source: "attention.v1", version: "attention.2026.1" },
} as const;
