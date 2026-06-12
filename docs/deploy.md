# Deploy

cfo runs as a small Docker Compose stack on a single tailnet host. It is reachable
**only over Tailscale** at `https://cfo.<tailnet>.ts.net` — the tailnet is the auth boundary, so
there is no app-level login (see [architecture.md](architecture.md)). No GitHub CI: the gate
(`npm run test:ci`) runs locally before you push.

## Layout

- `Dockerfile` — multi-stage, Next standalone output (`base → deps → build → jobs → prod`).
- `docker-compose.server.yml` — `tailscale` (the node + TLS), `app`, `app_setup` (migrations),
  `cron` (the daily feed trigger), `db`.
- `stack` — the one script that does it all.
- `infra/tailscale/serve.json` — `tailscale serve` config: `https://cfo.<tailnet>` → `127.0.0.1:3222`.

The app has **no host port**: it shares the Tailscale node's network namespace and is published
only through `tailscale serve`. Postgres lives in an **external** volume (`cfo_postgres_data`) so a
`compose down -v` can never drop the ledger.

## Local dev

```sh
docker compose up -d          # or: ./stack local init   (dev Postgres on :5433)
npm run db:migrate && npm run seed
npm run dev                   # http://localhost:3222
```

## First boot on the host (one time)

```sh
git clone git@github.com:albert-carreras/cfo.git
cd cfo
cp .env.server.example .env   # set POSTGRES_PASSWORD (+ matching DATABASE_URL), TS_AUTHKEY, CFO_PUBLIC_URL
./stack prod init
```

`TS_AUTHKEY` is a reusable, pre-approved key from
<https://login.tailscale.com/admin/settings/keys>. On first boot the node registers as `cfo` and
gets `https://cfo.<tailnet>.ts.net`.

## Deploy a change

```sh
# locally
npm run test:ci && git push

# on the host
cd cfo && ./stack prod deploy   # pull -> migrate -> recreate app, Tailscale and cron
```

## Day to day

```sh
./stack status prod
./stack logs prod app
./stack ready                   # curl https://cfo.<tailnet>/api/ready
```

## The daily feed

A tiny `cron` sidecar (busybox crond, `infra/cron/crontab`) hits
`http://127.0.0.1:3222/api/cron/daily` over the shared Tailscale netns, twice: at 06:15
UTC (settled previous EU closes, after the US close) and again at 07:45 UTC — after
Xetra/Euronext open at 07:00, when Yahoo's daily bar rolls to the current day, so the
home's price freshness reads today rather than yesterday. Each run
fetches a price for every live holding, FX from the ECB, upserts both (idempotent — safe
to re-run), writes an `internal` snapshot, and promotes a `strategic` one on month
rollover or material change. To run it by hand and see the per-symbol report:

```sh
curl https://cfo.<tailnet>.ts.net/api/cron/daily   # from any tailnet device
./stack logs prod cron                             # the schedule's own output
```

**A holding's `ticker` is its feed symbol** — exchange-suffixed where the listing needs
it (e.g. `VWCE.DE`; plain `SMH` for US listings). A holding with no ticker (or a wrong
one) is reported in the route's JSON and, once its price is >10 days old, flips the home
status to **Data stale** — it never silently keeps an old valuation quiet. Tickers are
facts: fix them in `scripts/seed.local.ts` *only* if you're re-seeding anyway (re-seeding
**wipes the ledger**), otherwise a one-line SQL `update holdings set ticker=… where isin=…`
on the box is the safe path.

## Seeding prod (one-time / rare)

`seed.local.ts` (real data) is **never committed** — it lives only on the host and is
**git-ignored**. The `seed` service **mounts** it from the host rather than baking it into the
image, so you edit it in place and re-run without a rebuild:

```sh
cd cfo
# edit scripts/seed.local.ts on the host (add accounts / holdings / open tax lots …)
./stack prod seed               # boots db, mounts seed.local.ts, runs `npm run seed`
```

⚠️ `seed` is **idempotent: it WIPES every table and reloads** from `seed.local.ts`. Anything
quick-logged in prod (`/log`) that isn't in the file is lost. **Day-to-day you never seed** — money
movements and monthly spend go through `/log`, and tax lots derive from the ledger (a `buy` opens a
lot, a `sell` consumes it FIFO). Seeding is only the **initial** load of slow-moving facts. Back up
first if unsure (see below).

## Backups

Not automated (the external data volume survives redeploys). To snapshot manually:

```sh
docker compose -f docker-compose.server.yml exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > cfo-$(date -u +%Y%m%dT%H%M%SZ).sql.gz
```
