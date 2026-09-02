// Credential keywords (e.g. secret variables) are checked by regex,
// so the format __VAR_NAME__ below does not trigger the credential-pattern detector.

import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/worker/index.ts',
    // BQC-7.1: the predeploy migration runner, bundled so the production
    // image runs it with plain `node dist-worker/migrate-deploy.js` — no tsx
    // or TypeScript toolchain in the runtime container.
    'migrate-deploy': 'scripts/migrate-deploy.ts',
    // Immutable-release proof: exercises only final schema reads on expand
    // and contract schemas from the exact web/worker image bits.
    'google-import-final-schema-probe': 'scripts/google-import-final-schema-probe.ts',
    // Issue #408: the capability refusal explainer's operator surface. The
    // runtime image ships neither `scripts/` nor tsx, so without this entry the
    // command could only ever run against a local stack — and the live
    // closed-beta database is reachable only from inside the container
    // (`postgres16.railway.internal`, no TCP proxy). Bundled here it runs as
    // `node dist-worker/report-capability-refusal.js` over `railway ssh`,
    // which is what makes "ask the running system why" true rather than
    // aspirational. Read-only: SELECTs plus the harness's own decision audit.
    'report-capability-refusal': 'scripts/ops/report-capability-refusal.ts',
    // Error monitoring must initialize before the worker imports queue/runtime
    // modules. Docker and start:worker load this through Node's supported ESM
    // --import preload path. The web counterpart has its own config so
    // `pnpm build` alone remains a complete web artifact.
    'worker-observability-preload':
      'src/shared/observability/worker-observability-preload.ts',
  },
  outDir: 'dist-worker',
  format: ['esm'],
  target: 'node22',
  splitting: false,
  sourcemap: true,
  clean: true,
  // Allows importing from shared code that uses `#/` path alias. tsup 8
  // exposes esbuild's alias map through this supported configuration hook.
  esbuildOptions(options) {
    options.alias = { '#': './src' }
  },
  // Don't bundle node_modules — the worker runs on Node.js
  // (bare names also match their subpath imports, e.g. 'better-auth' covers
  // 'better-auth/db/migration' and 'drizzle-orm' covers
  // 'drizzle-orm/node-postgres/migrator' — verified in the built bundle).
  noExternal: [/^#/],
  external: [
    '@sentry/node',
    'pg',
    'ioredis',
    'bullmq',
    'pino',
    'better-auth',
    'drizzle-orm',
  ],
  env: {
    NODE_ENV: process.env.NODE_ENV ?? 'production',
  },
})
