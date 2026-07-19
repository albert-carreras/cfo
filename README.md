# CFO

A personal financial record that answers two quiet questions:

1. What is my position now, and does it still look okay?
2. Is my data ready to take into a serious decision conversation?

CFO keeps verified accounts, investments, property, other assets, debt and planning inputs. Pure
calculators produce the current Picture and preserve provenance. A narrow monthly AI check adds a
short qualitative note. For decisions—buying a house, changing work, handling an inheritance—the
app exports an up-to-date Markdown context pack for a ChatGPT or Claude project.

It deliberately has no in-app Ask chat, mortgage wizard, tax-advice engine, transaction-heavy
workflow or generated financial essay.

## Product

- **Picture** — net worth, liquidity, investable assets, property equity, debt, runway, data state,
  open plans and latest CFO check.
- **Data** — confirm all current values as one dated observation; add an account, investment,
  property/mortgage, car/other asset or loan; maintain assumptions and plans.
- **History** — human updates, strategic snapshots and checks.
- **Export** — one Markdown file containing verified facts, calculated metrics, dates, gaps and
  instructions that preserve the evidence boundaries in an external AI conversation.
- **Automation** — daily price/FX refresh and one idempotent monthly check using `gpt-5.6-sol` by
  default. Without an API key, the deterministic product still works.

Every personal number is **Verified** or **Calculated**. Model prose is **Judgment** and is not
allowed to contain figures.

## Run locally

```sh
docker compose up -d
cp .env.example .env
npm install
npm run db:migrate
npm run seed
npm run dev
```

`npm run test:ci` is the local gate. The seed command is destructive and uses the committed
synthetic fixture unless a git-ignored `scripts/seed.local.ts` exists.

Start with [docs/principles.md](docs/principles.md) and [CLAUDE.md](CLAUDE.md). Production details
are in [docs/deploy.md](docs/deploy.md).

## License

[MIT](LICENSE)
