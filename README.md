# CFO — a calm personal financial brain

> **This is not an "AI CFO."**
> It's a deterministic personal financial brain with a calm status screen.
> The voice sits on top — and is never allowed to invent a number.

A single, trustworthy place to check on apartments, ETFs, pensions and cash — one that
**knows everything, stays calm on the surface, and is deep enough underneath that its reports
earn confidence**, so you can step back from daily market-watching without anxiety.

## What it does

- **An append-only ledger and dated facts** — accounts, holdings with FIFO tax lots, properties,
  pensions (re-anchored by dated statements), assumptions. Corrections are new rows; current
  state = opening baseline + movements since. Every figure traces to its sources.
- **Pure, versioned, tested calculators** — net worth, FIRE/runway (nominal and real, with
  conservative/base/optimistic bands and explicit failure modes), data quality, a slow confidence
  score, concentration, property yield, and Spanish/Cataluña tax: FIFO capital gains, savings &
  general IRPF scales, wealth tax (IP) with the IRPF–IP límite conjunto, and a derived 4-year
  loss carry-forward. The tax card prints its exclusions next to the number.
- **A daily market feed** behind pure parsers (prices + ECB FX), with a monthly *strategic*
  snapshot promoted on month rollover or material change — market noise never pokes the surface.
- **A deterministic status engine** — one calm status on home (totals masked by default; full
  depth one tap away on `/detail`), honest `Data stale`, and coarse-by-design amounts
  (~3 significant figures, runway in years).
- **A scenario engine** — sell-a-property (rough plusvalía), sell-a-position at-once-vs-spread on
  the FIFO engine, planned events: each a pure transform over the snapshot facts, recomputed in
  full, with the diff as the advice's number.
- **The voice (optional)** — an Ask page, a scheduled monthly Review (reassurance digest,
  web-sourced regulatory watch, tax-table re-verification, at most one gated recommendation),
  a standing Picture narrative, and an accountability loop that re-measures every journaled
  decision. The LLM only ever sees calculator JSON and assumption summaries; every figure it
  shows is a server-rendered metric token; no API key ⇒ every surface degrades to its
  deterministic floor.
- **Optional push** via [ntfy](https://ntfy.sh) — coarse pings (status transitions, material
  changes, feed failures, published reviews), never amounts.

## The one rule

**The trust core must exist before the voice.** Deterministic, sourced, tested numbers first.
The LLM narrates calculator outputs; it never originates a number about you.

## Core principle

The anxiety firewall governs **presentation, not engine depth**. The brain can be as deep and
complex as needed; the surface just doesn't constantly poke you. Full detail is always one tap
away — never hidden behind paternalistic UX.

## Run it

Local dev (Node 24, Docker for Postgres):

```sh
docker compose up -d
cp .env.example .env
npm install
npm run db:migrate && npm run seed   # seeds the committed synthetic fixture
npm run dev
```

`npm run test:ci` is the gate — lint + typecheck + the full Vitest suite, no DB needed.

Self-hosting: the intended deployment is a single host reachable **only over Tailscale** — the
tailnet is the auth boundary, so there's no app-level login. See [docs/deploy.md](docs/deploy.md)
for the Docker Compose stack (app + Postgres + Tailscale node + cron sidecar).

Your real data lives in a git-ignored `scripts/seed.local.ts` and your `.env`; only the synthetic
fixture is committed.

## Documentation

| Doc | What's in it |
|---|---|
| [docs/principles.md](docs/principles.md) | The non-negotiables. Read this first. |
| [docs/architecture.md](docs/architecture.md) | The three layers + one automation, tech stack, privacy. |
| [docs/data-model.md](docs/data-model.md) | Tables: facts, ledger, snapshots, decision journal, data quality. |
| [docs/input.md](docs/input.md) | How data gets in: initial setup, regular updates, future events. |
| [docs/calculators.md](docs/calculators.md) | The deterministic trust core, the status engine, scenarios, tax. |
| [docs/ai-analyst.md](docs/ai-analyst.md) | The pull-first Ask layer and the monthly Review analyst. |
| [docs/roadmap.md](docs/roadmap.md) | What's deliberately not built yet. |
| [docs/deploy.md](docs/deploy.md) | The Tailscale-only production stack. |

## License

[MIT](LICENSE)
