# CFO — agent guide

A calm personal financial brain: a **deterministic, sourced, tested** financial core with a calm
status screen, and an LLM "voice" on top that is never allowed to invent a number.

**Status: the spec in `docs/` is implemented and green behind `npm run test:ci`** — the trust core
(schema + append-only ledger, the `deriveState` projection, the pure calculators in `src/calc/*`,
quick-log, the calm home/detail/reviews UI), the Spanish/Cataluña tax engine (`src/calc/taxES.ts`:
FIFO capital gains, IRPF scales, wealth tax, derived loss carry-forward, versioned year-selected
configs), the daily market feed (`src/server/feed/*` + the `/api/cron/daily` sidecar, material
change, monthly strategic promotion), the scenario engine (`src/calc/scenario.ts` — pure
transforms over `SnapshotFacts`, the diff is the advice's number), and the voice (`src/ai/*`:
Ask with server-rendered metric tokens, the scheduled monthly Review with its deterministic
floor, the Picture narrative, the decision journal + accountability loop). What remains is the
backlog (`docs/roadmap.md`). The whole spec lives in `docs/`; read it before writing code —
the design is load-bearing and already decided.

## The one rule

**The trust core must exist before the voice.** Deterministic, sourced, tested numbers first; the
LLM analyst only narrates a financial brain that is boringly correct without it.

## Read first — `docs/` is the design source of truth

- [docs/principles.md](docs/principles.md) — the non-negotiables. Read this first.
- [docs/architecture.md](docs/architecture.md) — three layers + one automation, stack, privacy/infra.
- [docs/data-model.md](docs/data-model.md) — facts, append-only ledger, snapshots, decision journal.
- [docs/input.md](docs/input.md) — how data gets in (initial setup, regular updates, future events).
- [docs/calculators.md](docs/calculators.md) — the deterministic trust core, the status engine, the `CalcResult` contract.
- [docs/ai-analyst.md](docs/ai-analyst.md) — the pull-first Ask layer and the Review analyst.
- [docs/roadmap.md](docs/roadmap.md) — what's deliberately not built yet.

If code contradicts a doc, **the doc wins** — unless you update the doc in the same change.

## Invariants you must not break

These are the spine (distilled from `principles.md`). Violating them in code breaks the product:

1. **Three epistemic categories stay distinct everywhere** — **Verified** (a fact you entered),
   **Calculated** (a deterministic output), **Judgment** (an LLM / rule-of-thumb opinion). Never
   blur them in data, API, or UI.
2. **Calculators compute; the LLM never originates a number about the user.** Every figure shown
   about *you* comes from a deterministic calculator fed by a Verified fact.
3. **Calculators are pure, deterministic, versioned, Vitest-tested.** Each returns a `CalcResult`
   carrying provenance (`inputs`). No I/O, no clock, no randomness inside them.
4. **The ledger is append-only.** Never edit or delete a `movements` row — corrections are new
   rows. Facts are soft-closed (`disposedAt`), never deleted. Current state = **opening baseline +
   movements since**.
5. **Provenance everywhere.** Every Calculated figure traces back to the snapshot + the
   fact/movement/price rows it used, with a date.
6. **The LLM lives behind `src/ai/*` and receives only calculator JSON + assumption summaries**
   — never raw accounts, movements, prices, documents, or `CalcResult.inputs` id lists. Pull-first: it answers when asked, never pushes market opinions. Removing
   `OPENAI_API_KEY` disables all external LLM calls; every AI surface degrades to its
   deterministic floor.
7. **The status engine (`src/calc/status.ts`) is a deterministic, tested calculator, not UI logic.**
8. **The provider name stays out of the product design** — it's an implementation detail behind the
   interface (recorded once, in `architecture.md`).
9. **Irreversible actions are gated behind manual review** (sell a property, quit the job, sell a
   large position > €100k, pension withdrawal). The app may not sound certain about them.

## Stack & conventions

- **Next.js (App Router) + TypeScript + Tailwind** (v4, via `@tailwindcss/postcss`)
- **Drizzle ORM + Postgres** (the `postgres` driver) — schema at `src/server/db/schema.ts`,
  migrations in `drizzle/`, `DATABASE_URL` env
- **Zod** for validation, **Vitest** for tests, `@paralleldrive/cuid2` for ids, `tsx` for scripts
- **Node 24**, **npm** (no pnpm/yarn)

## Repo layout

- `docs/` — the spec (design source of truth)
- `src/app/*` — Next App Router (the calm home / status screen)
- `src/calc/*` — pure calculators: `valuation.ts`, `netWorth.ts`, `fire.ts`, `dataQuality.ts`,
  `status.ts`, `taxES.ts`, `confidence.ts`, `concentration.ts`, `scenario.ts`, …
- `src/ai/*` — the voice, behind one interface
- `src/server/db/schema.ts` — Drizzle schema (facts + append-only ledger)
- `scripts/seed.ts` — destructive dev/test seed onto the committed synthetic fixture
  (`scripts/seed.fixture.ts`, which doubles as the test fixture) or a git-ignored `seed.local.ts`
- `drizzle/` — migrations

## Commands

| Command | What |
|---|---|
| `npm run dev` | Next dev server |
| `npm run test` / `test:watch` | Vitest |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | eslint (`--max-warnings=0`) |
| `npm run test:ci` | **the gate** — lint + typecheck + test |
| `npm run db:generate` / `db:migrate` / `db:studio` | drizzle-kit |

`test:ci` is the gate (pure, no DB); the DB commands need a running Postgres
(`docker compose up -d`, then `db:migrate` + `seed`).

## The `CalcResult` contract (the spine)

```ts
type CalcResult<T> = {
  snapshotId: string;   // ties the output to a point-in-time set of facts
  value: T;             // the typed numbers
  source: string;       // e.g. "netWorth.v1"
  version: string;      // e.g. "taxES.es-cat.2026.1"
  inputs: string[];     // ids of the facts/movements/prices it used (provenance)
};
```

## Infra

Served **only over Tailscale** at `cfo.<tailnet>.ts.net` (MagicDNS) — the tailnet is the auth
boundary, so **no app-level login / 2FA**. A single host on the tailnet (home server or a VPS) or
fully local, with Postgres on the same box. The LLM provider and the optional ntfy push topic
(`NTFY_URL`, coarse no-amount payloads — see `src/server/notify.ts`) are the only things outside
the tailnet; removing the env vars kills either egress.
