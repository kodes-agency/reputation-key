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
  },
  outDir: 'dist-worker',
  format: ['esm'],
  target: 'node22',
  splitting: false,
  sourcemap: true,
  clean: true,
  // Allows importing from shared code that uses `#/` path alias
  alias: {
    '#': './src',
  },
  // Don't bundle node_modules — the worker runs on Node.js
  // (bare names also match their subpath imports, e.g. 'better-auth' covers
  // 'better-auth/db/migration' and 'drizzle-orm' covers
  // 'drizzle-orm/node-postgres/migrator' — verified in the built bundle).
  noExternal: [/^#/],
  external: ['pg', 'ioredis', 'bullmq', 'pino', 'better-auth', 'drizzle-orm'],
  env: {
    NODE_ENV: process.env.NODE_ENV ?? 'production',
  },
})
