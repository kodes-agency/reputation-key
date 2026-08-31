import { defineConfig } from 'tsup'

// Local-stack-only one-shot commands. This bundle has its own image target and
// must never be copied into a web, worker, sidecar, or Railway runtime image.
export default defineConfig({
  entry: {
    'seed-e2e-user': 'scripts/seed-e2e-user.ts',
    'provision-ai-admission-role': 'scripts/local-stack/provision-ai-admission-role.ts',
    'provision-google-admission-role': 'scripts/ops/provision-google-admission-role.ts',
  },
  outDir: 'dist-local-tools',
  format: ['esm'],
  target: 'node22',
  splitting: false,
  sourcemap: true,
  clean: true,
  esbuildOptions(options) {
    options.alias = { '#': './src' }
  },
  noExternal: [/^#/],
  external: ['pg', 'ioredis', 'bullmq', 'pino', 'better-auth', 'drizzle-orm'],
  env: {
    NODE_ENV: process.env.NODE_ENV ?? 'production',
  },
})
