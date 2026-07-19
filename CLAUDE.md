# CFO — agent guide

CFO is a small personal financial record: a current Picture, an occasional Data update workspace,
a History, and an exportable Markdown brief for decision-making in a general AI project. A narrow
monthly AI check reads deterministic metrics and says whether the position looks okay or deserves
attention. There is no in-app advice chat or scenario engine.

## The one rule

**Trust core before voice.** Verified facts and deterministic, sourced, tested calculations own
every personal number. The model may add a short qualitative Judgment; it never originates a
number, researches the web, or makes a transaction recommendation.

## Read first

- [docs/principles.md](docs/principles.md) — product invariants.
- [docs/architecture.md](docs/architecture.md) — boundaries and automation.
- [docs/data-model.md](docs/data-model.md) — stored facts, observations and history.
- [docs/input.md](docs/input.md) — how real-life changes are recorded.
- [docs/calculators.md](docs/calculators.md) — the deterministic trust core.
- [docs/ai-analyst.md](docs/ai-analyst.md) — monthly check and Markdown handoff.

If code contradicts a doc, update the doc in the same change.

## Invariants

1. Keep **Verified**, **Calculated** and **Judgment** distinct in storage, APIs and UI.
2. All personal figures come from the trust core; the LLM receives a summary and writes no digits.
3. Calculators in `src/calc/*` are pure, versioned and tested. Each returns `CalcResult<T>` with
   provenance ids.
4. Dated observations are append-only. Legacy movements remain append-only; corrections are new
   rows. Facts are soft-closed, never deleted through product flows.
5. An open plan is context, not a present asset and not a simulated scenario.
6. Removing `OPENAI_API_KEY` leaves the entire record, calculations, export and deterministic
   check working.
7. Data updates never wait for an LLM. The status engine remains deterministic.
8. Preserve old Ask/Review/Picture database tables as archival data unless a separately approved
   migration explicitly removes them. They are not active product surfaces.

## Product surface

- `/` — Picture: current position, independence-plan metrics, data state, open plans, latest check.
- `/data` — confirm current values in one dated batch; add assets/debt; edit planning inputs/plans.
- `/history` — monthly checks, human data updates and strategic snapshots.
- `/api/export` — current Markdown context pack for ChatGPT/Claude projects.
- `/api/cron/daily` — market prices, FX and deterministic snapshots.
- `/api/cron/check` — idempotent monthly qualitative check.

The UI uses a Japanese early-2000s technical-print aesthetic shared with piso-radar: dense grid,
tabular numerals, square controls, black rules and restrained vermillion registration marks.

## Stack and commands

Next.js App Router, TypeScript, Tailwind v4, Drizzle/Postgres, Zod, Vitest, Node 24 and npm.

| Command | Purpose |
|---|---|
| `npm run dev` | Local app on port 3222 |
| `npm run test:ci` | Gate: lint, typecheck, tests |
| `npm run db:generate` | Generate a migration after schema changes |
| `npm run db:migrate` | Apply migrations |
| `npm run seed` | Destructive synthetic/local seed |

The database schema is `src/server/db/schema.ts`; migrations are in `drizzle/`. Real financial
data belongs only in Postgres or git-ignored `scripts/seed.local.ts`.

## `CalcResult` contract

```ts
type CalcResult<T> = {
  snapshotId: string;
  value: T;
  source: string;
  version: string;
  inputs: string[];
};
```

## Infra

Production runs on `au` behind Cloudflare Access and an outbound-only Tunnel. Postgres is private.
The model API and optional ntfy endpoint are the only application egress beyond market/ECB feeds.
See [docs/deploy.md](docs/deploy.md).
