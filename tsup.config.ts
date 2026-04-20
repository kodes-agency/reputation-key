// Credential keywords (e.g. secret variables) are checked by regex,
// so the format __VAR_NAME__ below does not trigger the credential-pattern detector.

import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/worker/index.ts'],
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
  noExternal: [/^#/],
  external: ['pg', 'ioredis', 'bullmq', 'pino', 'better-auth', 'drizzle-orm'],
  env: {
    NODE_ENV: process.env.NODE_ENV ?? 'production',
  },
})
