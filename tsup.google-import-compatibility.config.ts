import { defineConfig } from 'tsup'

/**
 * Frozen rollout-only Google import compatibility binary. It is built into a
 * dedicated image and is never an entry point of the web or worker bundles.
 */
export default defineConfig({
  entry: {
    'google-import-lifecycle': 'scripts/ops/google-import-lifecycle.ts',
  },
  outDir: 'dist-google-import-compatibility',
  format: ['esm'],
  target: 'node22',
  splitting: false,
  sourcemap: true,
  clean: true,
  noExternal: [/^#/],
  external: ['pg', 'ioredis', 'bullmq', 'pino', 'better-auth', 'drizzle-orm'],
  env: {
    NODE_ENV: 'production',
  },
})
