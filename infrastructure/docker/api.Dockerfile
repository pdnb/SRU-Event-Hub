# syntax=docker/dockerfile:1.7
# SRU Event Hub API – multi-stage build (pnpm workspace). Build context: repository root.
FROM node:22.12-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
# (corepack bundled with this Node patch has stale npm signing keys → install pnpm directly)
RUN npm install -g pnpm@10.28.0 --no-fund --no-audit
WORKDIR /repo

FROM base AS build
# Toolchain for native modules (argon2) when the prebuilt binary does not fit the image's glibc.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
# Placeholder so `prisma generate` can load prisma.config.ts; no database is contacted at build time.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @sru/api...
RUN pnpm --filter "@sru/api^..." build && pnpm --filter @sru/api build
# Self-contained production bundle with only runtime dependencies.
# (The generated Prisma client lives under src/ and is compiled into dist/ by nest build.)
RUN pnpm --filter @sru/api deploy --prod --legacy /out && cp -r apps/api/dist /out/ && cp -r apps/api/assets /out/

# Release step: `docker compose run --rm migrate` applies pending migrations (needs the Prisma CLI).
FROM build AS migrate
WORKDIR /repo/apps/api
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:22.12-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd -r app && useradd -r -g app app
COPY --from=build --chown=app:app /out ./
USER app
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Migrations are applied as a separate release step: `npx prisma migrate deploy` (docs/DEPLOYMENT.md).
CMD ["node", "dist/main.js"]
