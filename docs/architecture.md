# Architecture

Three layers + one automation. The provider for the voice is swappable; the deterministic core
is not.

```
  YOU ──(forms: facts · quick-log: monthly spend + money movements)──┐
                                                                      ▼
  Market prices + FX ──(daily, internal only)──►  THE BRAIN  (Postgres: append-only ledger + facts + provenance)
                                                                      │
                                                                      ▼
                                       CALCULATORS  (pure TypeScript, Vitest-tested)
                                  net worth · FIRE · (later) Spain+Cataluña tax · data quality · ...
                                                                      │  deterministic JSON snapshots
                                                                      ▼
                                STATUS ENGINE  ──►  one status + next strategic snapshot + material changes
                                                                      │
                                                                      ▼
                              THE VOICE  (LLM behind an interface — pull-first)
                         Ask · (later) scheduled Review analyst · sees only calculator JSON + assumption summaries, never raw accounts
```

## Layer boundaries

- **The Brain** owns truth: facts + an append-only movement ledger + provenance. Nothing
  computes here; state is *derived* from facts and movements.
- **Calculators** are pure functions. Deterministic, tested, versioned. They are the trust
  core. They emit typed JSON snapshots (`snapshotId`, `source`, `version`).
- **Status engine** turns snapshots into one calm status + a next-review date + a list of
  material changes.
- **The Voice** is the only place an LLM appears. It is **pull-first** and consumes calculator
  JSON plus assumption summaries (the scalar judgment inputs the user entered, cited as
  provenance) — never raw account dumps, movements, prices or the `CalcResult.inputs` id lists.
  It lives behind `src/ai/*` so the provider can change without touching anything else.

## The price feed: daily internal, monthly visible

The brain updates prices/FX **daily** so valuations are always current internally. But the
**user-visible snapshot is monthly by default** — the surface only changes when a threshold
actually breaks. Example home state:

```
Last strategic snapshot: June 1
Internal prices updated:  today
No material change.
```

This is the firewall in action: deep updates underneath, calm surface on top.

**As built:** a cron sidecar in the compose stack hits `/api/cron/daily` twice a
day — 06:15 UTC for settled previous closes, 07:45 UTC after EU markets open so the
freshest price date is the current day (the route is idempotent; the second run refreshes
prices while the day's internal snapshot stays deduped). The route fetches a quote for every live holding (the holding's `ticker` is its feed
symbol, exchange-suffixed where needed, e.g. `VWCE.DE`) and one ECB daily-reference XML
for FX, upserts both into the `market_prices` / `fx_rates` history, recomputes the full
snapshot and persists it as **internal**. It promotes a **strategic** (user-visible)
snapshot only when the month rolled over — or off-cycle when
`src/calc/materialChange.ts` (a pure, versioned, tested calculator) says something
material changed. A deliberate quick-log is different from passive market movement: the
movement/spend row and a same-day strategic snapshot are committed together, so the user's
intentional update is immediately visible. A broken feed degrades honestly: prices past their weekly grace flip
`data_quality` → **Data stale**; a missing FX rate makes the holding *unpriced* (counted
0 and flagged), never silently mis-valued. The quote parser rejects a response for a
different symbol than requested and any non-positive price — a bad quote is skipped and
flagged per holding, never stored.

Like the LLM, the market-data providers are implementation details recorded only here:
**ECB daily reference rates** for FX (official, no key) and the **Yahoo Finance chart
API** for prices (free, no key) — both behind small fetchers in `src/server/feed/*` with
pure, Vitest-tested parsers, so either can be swapped without touching the core.

The same daily cron also keeps two **macro assumptions** fresh, once a month each
(`src/server/feed/ecbSeries.ts`, ECB Data Portal SDMX, free, no key): `inflation` from the
Spain HICP annual rate (`HICP/M.ES.N.000000.4D0.ANR`) and `interestRate` from the deposit
facility rate (`FM/B.U2.EUR.4F.KR.DFR.LEV` — a "date of changes" series, so announced future
rate changes are ignored until effective). Writes carry `source: "feed:ecb"`; rows stay
manually editable between refreshes, and a feed failure never blocks the daily update.

## Tech stack

- **Next.js (App Router) + TypeScript + Tailwind**
- **Drizzle ORM + Postgres**
- **Zod** for validation, **Vitest** for tests
- Node 24

Background jobs (price/FX fetch, scheduled reviews): start with a cron-hit Next.js route. Add a
real queue only if it's ever genuinely needed.

## AI provider abstraction

The voice talks to the model through one interface in `src/ai/*`. Per [principles](principles.md)
#12 the provider is an implementation detail — the deterministic core is provider-agnostic and the
voice is swappable, so the provider name stays out of the product design.

The concrete provider / model is recorded **only here**, as a build-time choice. The model needs
**Structured Outputs** (schema-constrained proposals) and a **web-search tool** (in-review research
only); a current frontier model behind a Responses-style API fits. Treat any specific pricing /
context-window figures as unverified until checked against live provider docs at build time.

**As built (Ask):** **OpenAI `gpt-5.5` via the Responses API** with Structured Outputs.
The client is one hand-written `fetch` in `src/ai/openai.ts` (no SDK) so the box's single
egress stays auditable, always sent with `store: false` (the provider must not retain the
exchange), a 60s abort timeout and a bounded `max_output_tokens`. Everything else in
`src/ai/*` is provider-agnostic: the `AskClient` interface, the context assembler (the
no-raw-dump boundary), the answer schema + deterministic validation, and the manual-review
gate. The key is the optional `OPENAI_API_KEY` env var — absent ⇒ Ask is unavailable,
everything deterministic still runs. (Env/infra variable naming is config, not product
design — the exemption to principle #13 lives in this paragraph.)

**As built (Review):** the review analyst uses the same provider/model through the same
hand-written fetch, plus the provider's **`web_search` tool** — the only request in the
app that carries a tool, because web research is allowed *only inside the review*
([ai-analyst](ai-analyst.md)). Still `store: false`, still schema-constrained
(`reviewReportSchema`), with a longer leash (5-minute timeout, larger output bound)
because it runs from cron with nobody waiting. The schedule is a second cron-sidecar line
hitting `/api/cron/review` on the 1st of each month (re-hits are no-ops — one review per
month). A missing key / a provider failure never break the cadence: the
review degrades to its deterministic floor and the row says so (`scope:
"deterministic"`, the reason in `llm_error`).

**As built (the picture):** the standing reassurance narrative uses the same provider/model
through the same fetch with an **Ask-shaped request — no tools** (the narrative is grounded in
the metrics alone), `store: false`, schema-constrained (`pictureNarrativeSchema`), and a longer
output bound than Ask (it's a verbose essay, generated off the request path). Same degradation:
the floor never depends on the provider.

## Privacy / security

The **tailnet is the security boundary**: the app is served only over Tailscale at
`cfo.<tailnet>.ts.net` (MagicDNS), never on the public internet (no Funnel). Only your own devices
can reach it, so there's **no app-level login or 2FA** — Tailscale handles identity and access. The
trade-off is explicit and accepted: anything on your tailnet can reach the financial data, so the
threat model is "I trust every device I've joined."

The data is still sensitive. The implementation provides the private
tailnet boundary, local Postgres, the append-only movement ledger and snapshot provenance.
Audit logging for editable facts and export/delete tooling stay on the [backlog](roadmap.md):

- **The LLM boundary**: the model lives *outside* the tailnet, so it's the one boundary that
  isn't network-enforced. By construction the LLM only ever receives summarised calculator JSON
  and assumption summaries — never raw documents or account dumps — and every request carries
  `store: false`. Disabling all external LLM calls = removing `OPENAI_API_KEY`; the `src/ai/*`
  factory returns a disabled marker before any provider code could run, and every AI surface
  degrades to its deterministic floor. (An earlier UI "Sensitive mode" toggle was
  removed in June 2026 as redundant with the key.)
- **Push notifications (ntfy, optional)**: the optional `NTFY_URL` env var (e.g.
  `https://ntfy.sh/<topic>`) turns on push pings — a status-level transition, an off-cycle
  material-change promotion, feed failures, a published monthly review, a dead daily update.
  ntfy topics are guessable, so the payload discipline is deterministic and tested
  (`src/server/notify.ts`): status labels, percents and months only, **never € amounts**. The
  send is fire-and-forget — a dead notifier can never fail the pipeline it reports on; absent
  env ⇒ no-op.
- encrypted secrets at rest *if* third-party tokens ever exist (none in the manual-entry core — no
  open banking unless ever wanted)
- Hosting: a single host on the tailnet (a home server, or a VPS joined to the tailnet) or fully
  local, with Postgres on the same box. Nothing in the design depends on the choice.
