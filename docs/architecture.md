# Architecture

```text
human confirmations ─┐
market prices + FX ──┼─> Postgres facts + dated observations
legacy movements ───┘                 │
                                      v
                         pure TypeScript calculators
                  valuation · net worth · FIRE · freshness
                         status · concentration · change
                         │                         │
                         v                         v
                  Picture + History        Markdown context pack
                         │
                         v
              narrow monthly qualitative check
```

## Boundaries

- **Record:** Drizzle/Postgres owns verified facts and append-only history. `loadFacts` is the I/O
  boundary into calculator input.
- **Trust core:** `src/calc/*` has no database, network, clock or randomness. Dates enter as
  arguments. Every result carries calculator/version/provenance metadata.
- **Presentation:** Picture shows today’s computed position. Data writes dated observations.
  History exposes durable checkpoints.
- **AI check:** `src/ai/check.ts` calls the Responses API with structured output, `store:false`, no
  tools and no web. The default model is `gpt-5.6-sol`. `src/server/healthCheck.ts` owns scheduling,
  deterministic fallback, verdict strengthening and persistence.
- **Decision handoff:** `src/server/contextPack.ts` produces Markdown. Open-ended analysis happens
  outside this application.

## Automation

`/api/cron/daily` refreshes live security prices and ECB FX, writes an internal snapshot, and
promotes a strategic snapshot on month rollover or material change. Feed failures remain visible
through freshness rather than blocking all updates.

`/api/cron/check` runs after the daily feed on the first day of each month. Scheduled runs dedupe
by month. A missing provider key or model error persists a deterministic check instead of breaking
the cadence.

## Privacy

Production is behind Cloudflare Access; the origin and Postgres are private. The model receives a
small calculated summary, not raw movements or provenance identifiers. Markdown export is an
explicit user action and contains personal financial data.

## Legacy data

Old Ask decisions, Reviews and generated Pictures remain in legacy database tables so a migration
does not destroy history. No active route or service reads them. The ledger also remains supported
for existing data and rare exact movements, but there is no transaction-entry product surface.
