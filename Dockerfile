# syntax=docker/dockerfile:1
ARG SOURCE_REVISION=unknown
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
#     idempotent migration sequence; see scripts/migrate-deploy.ts header)
#   - healthcheck: GET /api/health/started (healthcheckTimeout 30s) — BQC-7.2:
#     the platform activation gate consumes STARTUP semantics (container +
#     migrations + policy complete), NOT liveness. Activation ≠ liveness:
#     /api/health/live stays dependency-free and backs the container-level
#     HEALTHCHECK below (a post-activation dependency flap degrades readiness
#     but must never restart the process).
#   - numReplicas 1, restart ON_FAILURE×10, drainingSeconds 30 (> web drain)
#   - region: platform/dashboard setting, deliberately not pinned in code
#     (ADR 0048 single 'us' cell: us-west2 / us-east4-eqdc4a)
#
# Graceful shutdown: SIGTERM → srvx drains HTTP (5s) in parallel with the
# nitro graceful-shutdown plugin closing BullMQ queue connections, the shared
# Redis client and the pg pool (3s budget each) — the process then exits
# naturally well inside drainingSeconds (verified: ~1.3s after traffic).
# ─────────────────────────────────────────────────────────────────────────────

# node:22-slim (bookworm) — digest resolved 2026-07-31 (created 2026-07-29;
# BQC-7.7: bumped from the 2026-07-14 build to clear base-image CVE findings).
#
# A digest bump MUST keep the node/ICU/Unicode triple asserted below. Web and
# worker run the AI review-language catalogue, which fails closed when the
# runtime does not match its pinned triple; a silent patch bump would degrade
# every analysis and reply draft. If a bump must move the triple, regenerate
# src/shared/generated/ai-review-language-canonical-regions-v1.ts
# (pnpm tsx scripts/generate-ai-review-language-regions.ts) and re-run the AI
# language corpus in the same change. Same assertion and failure style as
# Dockerfile.ai-egress-gateway / Dockerfile.ai-execution-admission.
FROM node:22-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46 AS base
# HUSKY=0: Husky's `prepare` must not try to install git hooks in the image.
# COREPACK_HOME + the pinned `corepack install` below: identical to the other
# eight Dockerfiles ON PURPOSE. Docker keys a layer on the instruction text, so
# any drift in this prefix gives each image its own `pnpm install` layer instead
# of one shared chain — five installs per cold daemon in CI.
ENV PNPM_HOME=/pnpm \
    COREPACK_HOME=/opt/corepack \
    PATH=/pnpm:$PATH \
    HUSKY=0
RUN mkdir -p "$COREPACK_HOME" \
    && corepack enable \
    && corepack install --global pnpm@10.6.5
WORKDIR /app
RUN node -e "const expected={node:'22.23.2',icu:'78.2',unicode:'17.0'}; for (const [key,value] of Object.entries(expected)) if (process.versions[key] !== value) throw new Error(key+' runtime drift')"

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
    pnpm build && pnpm build:worker \
 && node scripts/check-google-import-artifacts.mjs final .output dist-worker

# ── Production-only dependencies (runtime: worker externals + migrate trio) ─
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
# --ignore-scripts: the root `prepare` (husky, a devDependency) must not run
# here; no production dependency needs an install script (verified against
# pnpm.onlyBuiltDependencies).
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# ── Web runtime ──────────────────────────────────────────────────────────────
FROM base AS web
ARG SOURCE_REVISION
ENV NODE_ENV=production \
    IMAGE_SOURCE_REVISION=$SOURCE_REVISION
LABEL org.opencontainers.image.revision=$SOURCE_REVISION \
      com.repkey.google-import-contract=final \
      com.repkey.rollout-scope=serving-final
# Re-assert the pinned AI language runtime in the serving stage: web AND worker
# (dist-worker) both execute the review-language catalogue, which fails closed on
# a drifted node/ICU/Unicode triple. Explicit here so a future `FROM` change in
# this stage cannot silently lose the base-stage assertion.
RUN node -e "const expected={node:'22.23.2',icu:'78.2',unicode:'17.0'}; for (const [key,value] of Object.entries(expected)) if (process.versions[key] !== value) throw new Error(key+' runtime drift')"
# BQC-7.7: the runtime never installs packages — strip the npm CLI shipped in
# the base image (its bundled deps carry known CVEs: grype container gate).
# node itself is untouched; corepack/pnpm shims stay for operator tooling.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
# .output is fully traced by Nitro (no node_modules needed to serve);
# prod node_modules is here for the worker/migrate externals (pg, ioredis,
# bullmq, pino, better-auth, drizzle-orm) used by dist-worker/migrate-deploy.js.
COPY --from=build /app/.output ./.output
COPY --from=build /app/dist-worker ./dist-worker
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.runtime.json ./package.json
# Predeploy migration inputs (read by dist-worker/migrate-deploy.js); the
# journal is ALSO read at runtime by the readiness/startup migration check
# (src/shared/health/readiness.ts anchors it at cwd = /app here):
COPY drizzle ./drizzle
COPY scripts/migrations/2026-07-06-permission-version-triggers.sql \
     scripts/migrations/2026-07-06-permission-version-triggers.sql
USER node
EXPOSE 3000
# Container-level HEALTHCHECK stays on /api/health/live (continuous LIVENESS
# → restart posture); the platform activation gate is /api/health/started.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.NITRO_PORT||process.env.PORT||3000)+'/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", ".output/server/index.mjs"]
