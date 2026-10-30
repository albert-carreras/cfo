# Deploy

cfo runs on **`au`** as a small Docker Compose stack. The app is published only on
`127.0.0.1:3222`; an outbound-only Cloudflare Tunnel and a tiny Workers VPC edge proxy expose it at
**https://cfo.bored.cat**. The app has no login: Cloudflare Access is the authentication boundary.

Tailscale remains the management path for SSH and git, but it does not serve the app.
There is no GitHub CI: run the local gate (`npm run test:ci`) before pushing.

## Topology

```
browser
  -> Cloudflare Access (default-deny identity policy)
  -> cfo.bored.cat / Worker custom domain
  -> cfo-edge Worker
  -> Workers VPC binding (tunnel a28aa82a-795e-43a1-b025-579b43ed1893)
  -> cloudflared-cfo.service on au (outbound QUIC only)
  -> http://127.0.0.1:3222
  -> cfo-prod-app-1 (Next.js)
  -> cfo-prod-db-1 (private Compose network + external data volume)
```

The edge Worker in `infra/cloudflare/` preserves the request method, streaming body, cookies and
Access headers while changing only the destination URL. It forces `Cache-Control: private,
no-store` and `X-Robots-Tag: noindex`. `workers_dev` and preview URLs are disabled, so the custom
domain is the Worker's only public entry point.

Postgres lives in the external `cfo_postgres_data` volume, so `compose down -v` cannot drop the
ledger. Its port is never published. The app's host port is explicitly bound to loopback, and the
cron sidecar reaches `http://app:3222` over the private Compose network.

## Layout

- `Dockerfile` — multi-stage Next standalone output (`base -> deps -> build -> jobs -> prod`).
- `docker-compose.server.yml` — `app`, `app_setup` (migrations), `cron`, and `db`.
- `infra/cloudflare/worker.js` + `wrangler.jsonc` — the no-cache edge proxy and tunnel binding.
- `infra/systemd/cloudflared-cfo.service` — the dedicated connector service on `au`.
- `stack` — local/prod lifecycle, health and logs.

## Local dev

```sh
docker compose up -d          # or: ./stack local init (dev Postgres on :5433)
npm run db:migrate && npm run seed
npm run dev                   # http://localhost:3222
```

## Cloudflare resources

- Account: `17ef3b088f7d0af621420d0313ff4d39`
- Tunnel: `cfo-au` / `a28aa82a-795e-43a1-b025-579b43ed1893`
- Worker: `cfo-edge`
- Custom domain: `cfo.bored.cat`
- Connector unit: `cloudflared-cfo.service`
- Root-readable token: `/etc/cloudflared/cfo.token`

The token is never committed or passed as a process argument. The systemd unit reads it with
`--token-file`; the connector is pinned to QUIC because the Workers VPC path requires it. The
Worker's VPC binding owns routing, so the tunnel deliberately has no public hostname ingress rule
and no `cfargotunnel.com` DNS record. This prevents a route around the Worker/Access hostname.

## Cloudflare Access — create before publishing

Do not deploy the Worker custom domain until this application exists. Without Access,
`cfo.bored.cat` would be reachable by anyone on the Internet.

1. In Cloudflare, open **Zero Trust -> Access controls -> Applications** and create a
   **Self-hosted and private** application.
2. Name it `cfo`; add the public hostname `cfo.bored.cat` with no path so the whole site is
   protected.
3. Add an **Allow** policy whose Include rule contains only the exact email address(es) permitted
   to see the financial data. Do not use `Everyone` and do not use one-time PIN as the sole Include
   rule.
4. Select the existing identity provider. If using email codes, enable one-time PIN as a login
   method but keep the policy restricted to the exact email address(es).
5. Use a one-week session as a reasonable starting point and create the application.
6. In a private browser window, verify an allowed identity reaches the app and another identity is
   denied. Confirm the matching policy in Access authentication logs.

Access applications are default-deny: a user must match an Allow policy. The origin stays private,
the Worker has no `workers.dev` URL, and the tunnel has no public route.

## First boot / Tailscale Serve cutover

Install the `cfo-au` tunnel token as `/etc/cloudflared/cfo.token`, owned by root and mode `0600`,
then update the production environment:

```sh
cd ~/cfo
cp .env.server.example .env   # first boot only; set Postgres credentials
# Existing hosts: keep the current secrets, remove TS_AUTHKEY when rollback is no longer needed,
# and set CFO_PUBLIC_URL=https://cfo.bored.cat
./stack prod init
```

`prod init` installs/enables the committed connector unit, migrates the database, and recreates the
app and cron without the old Tailscale sidecar. `--remove-orphans` removes that old container; it
does not touch the external Postgres volume.

Only after the Access application exists, deploy the edge:

```sh
wrangler deploy -c infra/cloudflare/wrangler.jsonc
```

Validate the Access challenge and an authenticated browser session before considering the cutover
complete. Keep the old `TS_AUTHKEY` in the host `.env` until that validation succeeds; it is ignored
by the new stack and provides a short rollback window.

## Deploy a change

```sh
# locally
npm run test:ci && git push

# on au
cd ~/cfo && ./stack prod deploy   # pull -> migrate -> rebuild/recreate app + cron
```

Deploy `infra/cloudflare/` changes separately with Wrangler. Normal application deploys do not
restart the connector because its loopback destination is stable.

## Day to day

```sh
./stack status prod
./stack logs prod app
./stack logs prod cloudflared
./stack ready
```

`./stack ready` checks the local origin and then requires the public URL to return an Access
challenge (`302`, `401`, or `403`) to an unauthenticated request. A public `200` is treated as a
failure. Use a browser session for the complete authenticated path.

## Scheduled jobs

A tiny `cron` sidecar hits `http://app:3222/api/cron/daily` over the private Compose network at
06:15 UTC (settled previous EU closes, after the US close) and 07:45 UTC (after Xetra/Euronext
open). Each run fetches live holding prices and ECB FX and stores today's snapshot. The route is
idempotent.

To run it manually without exposing the cron route:

```sh
curl http://127.0.0.1:3222/api/cron/daily   # on au
./stack logs prod cron
```

A holding's `ticker` is its Yahoo Finance symbol (`VWCE.DE`, plain `AAPL`, and so on). A missing
or wrong ticker shows on the overview's attention list after a few days; it never silently keeps
an old valuation. Fix it on the investment's page.

After the feed, the sidecar hits `/api/cron/monthly` on the first day of each month: one ntfy push
about the month that ended. It dedupes by month. Run it manually with
`curl http://127.0.0.1:3222/api/cron/monthly`.

## Seeding prod (one-time / rare)

`scripts/seed.local.ts` contains real data and is never committed. It is mounted from the host into
the one-shot seed container:

```sh
./stack prod seed
```

The seed is destructive: it wipes every table and reloads from `seed.local.ts`. Anything recorded
in production but absent from the file is lost. Day-to-day maintenance belongs in the app; seed
only for the initial slow-moving fact load and back up first.

## Backups

The external data volume survives redeploys. To snapshot manually:

```sh
docker compose -f docker-compose.server.yml exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > cfo-$(date -u +%Y%m%dT%H%M%SZ).sql.gz
```

## Rollback

Before removing `TS_AUTHKEY` from the host, the previous release can be checked out and deployed to
recreate the dedicated Tailscale node/Serve path. That bypasses Cloudflare Access for tailnet
members, so use it only for diagnosis and remove it again after recovery. The external Postgres
volume is shared across either serving path and must never be deleted during rollback.
