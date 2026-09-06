import { defineConfig } from 'tsup'

// Tools that only the local-stack harness executes. The dedicated image keeps
// this bundle out of serving and Railway runtimes.
export default defineConfig({
  entry: {
    'control-proxy': 'scripts/local-stack/control-proxy.ts',
    'seed-e2e-user': 'scripts/seed-e2e-user.ts',
    'provision-google-admission-role': 'scripts/ops/provision-google-admission-role.ts',
    'tcp-relay': 'scripts/local-stack/tcp-relay.ts',
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
