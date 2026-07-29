# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# BQC-7.1 — production WEB image (TanStack Start + Nitro, node-server preset).
#
# One build path: this Dockerfile (nixpacks.toml was removed). Railway builds
# it per railway.json (build.builder=DOCKERFILE, dockerfilePath=Dockerfile).
#
# Reproducibility:
#   - base image pinned by digest (node:22-slim bookworm; bump deliberately)
#   - pnpm pinned via package.json packageManager (corepack resolves it)
#   - every install is `pnpm install --frozen-lockfile` (same lockfile CI tests)
#
# Least privilege / runtime posture:
#   - runs as the non-root `node` user
#   - the app writes NOTHING to disk at runtime — run with a read-only root
#     filesystem and a writable scratch tmpfs where the platform allows it:
#       docker run --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m ...
#   - no secrets in the image: build-time env below are the same inert
#     placeholders CI uses (required only so `vite build` can evaluate the
#     env schema); real config arrives via Railway service variables
#
# Deploy contract (railway.json):
#   - preDeployCommand: `node dist-worker/migrate-deploy.js` (advisory-locked,
#     idempotent migration trio; see scripts/migrate-deploy.ts header)
#   - healthcheck: GET /api/health/live (healthcheckTimeout 30s)
#   - numReplicas 1, restart ON_FAILURE×10, drainingSeconds 30 (> web drain)
#   - region: platform/dashboard setting, deliberately not pinned in code
#     (ADR 0048 single 'us' cell: us-west2 / us-east4-eqdc4a)
#
# Graceful shutdown: SIGTERM → srvx drains HTTP (5s) in parallel with the
# nitro graceful-shutdown plugin closing BullMQ queue connections, the shared
# Redis client and the pg pool (3s budget each) — the process then exits
# naturally well inside drainingSeconds (verified: ~1.3s after traffic).
# ─────────────────────────────────────────────────────────────────────────────

# node:22-slim (bookworm) — digest resolved 2026-07-29 (created 2026-07-14).
FROM node:22-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    # Husky's `prepare` must not try to install git hooks in the image.
    HUSKY=0
# corepack reads package.json#packageManager → exactly pnpm@10.6.5.
RUN corepack enable
WORKDIR /app

# ── Full dependencies (build toolchain) ──────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ── Build web bundle (.output) + worker/migrate bundles (dist-worker) ───────
FROM deps AS build
COPY . .
# Inert build-time placeholders (same values as ci.yml's Web build step) —
# the env schema is evaluated at build time; nothing connects anywhere.
# Inline on RUN so they never persist in image metadata/layers.
RUN NODE_ENV=production \
    DATABASE_URL=postgresql://build:build@localhost:5432/build \
    BETTER_AUTH_SECRET=build-placeholder-secret-32-characters-xx \
    BETTER_AUTH_URL=http://localhost:3000 \
    GOOGLE_CLIENT_ID=build-placeholder-client-id \
    GOOGLE_CLIENT_SECRET=build-placeholder-client-secret \
    ENCRYPTION_KEY=aabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd \
    OAUTH_STATE_SECRET=aabbccddaabbccddaabbccddaabbccdd \
    pnpm build && pnpm build:worker

# ── Production-only dependencies (runtime: worker externals + migrate trio) ─
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
# --ignore-scripts: the root `prepare` (husky, a devDependency) must not run
# here; no production dependency needs an install script (verified against
# pnpm.onlyBuiltDependencies).
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# ── Web runtime ──────────────────────────────────────────────────────────────
FROM base AS web
ENV NODE_ENV=production
# .output is fully traced by Nitro (no node_modules needed to serve);
# prod node_modules is here for the worker/migrate externals (pg, ioredis,
# bullmq, pino, better-auth, drizzle-orm) used by dist-worker/migrate-deploy.js.
COPY --from=build /app/.output ./.output
COPY --from=build /app/dist-worker ./dist-worker
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./
# Predeploy migration inputs (read by dist-worker/migrate-deploy.js):
COPY drizzle ./drizzle
COPY scripts/migrations/2026-07-06-permission-version-triggers.sql \
     scripts/migrations/2026-07-06-permission-version-triggers.sql
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.NITRO_PORT||process.env.PORT||3000)+'/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", ".output/server/index.mjs"]
