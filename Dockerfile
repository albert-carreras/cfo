# cfo — Tailscale-only Next.js app. Multi-stage build, Next standalone output.
# Multi-stage Next standalone build, stripped to the essentials.

FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1


FROM base AS deps

COPY package.json package-lock.json ./
RUN npm ci --include=dev


FROM deps AS build

ENV NODE_ENV=production
# Throwaway value so any module-load env validation passes. The home route is
# force-dynamic and the db client is lazy, so the build never connects.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"

COPY . .
RUN npm run build


# Migration / one-shot jobs runner (keeps devDeps so drizzle-kit is available).
FROM deps AS jobs

ENV NODE_ENV=production

COPY . .
CMD ["npm", "run", "db:migrate"]


FROM base AS prod

ENV NODE_ENV=production
ENV PORT=3222
ENV HOSTNAME=0.0.0.0
ENV HOME=/home/nextjs
ENV XDG_CACHE_HOME=/home/nextjs/.cache

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs --home-dir /home/nextjs --create-home nextjs \
 && mkdir -p /home/nextjs/.cache \
 && chown -R nextjs:nodejs /home/nextjs

COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3222

CMD ["node", "server.js"]
