# CFO

A personal financial record that stays easy to keep up to date.

- **Overview** — net worth with a year of history, what needs you, cash / investments / pension /
  property, whether your spending fits what your cash and investments can safely pay, and
  everything you own with how old each value is.
- **Something happened** — record events the way they happen: sold an investment (units out, cash
  in, gain and tax worked out), bought one, moved money, new balances, opened or closed something.
- **Tax on sales** — FIFO cost basis and Spain's savings scale give the tax to keep aside for each
  year's sales. It is deducted from net worth until you mark the year paid.
- **Export** — one Markdown brief with dated facts, calculated figures and known gaps, for a
  ChatGPT or Claude project when a real decision comes up.
- **Automation** — daily prices and FX, and one monthly push: how net worth moved and what needs
  you.

Every number is verified (entered, confirmed or fetched) or calculated by tested code. There is no
AI in the app and no advice.

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

Start with [CLAUDE.md](CLAUDE.md) and [docs/principles.md](docs/principles.md). Production
details are in [docs/deploy.md](docs/deploy.md).

## License

[MIT](LICENSE)
