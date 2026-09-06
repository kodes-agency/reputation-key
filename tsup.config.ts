// Credential keywords (e.g. secret variables) are checked by regex,
// so the format __VAR_NAME__ below does not trigger the credential-pattern detector.

import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: {
      index: 'src/worker/index.ts',
      // Bundled so production can migrate with plain Node, without tsx or the
      // TypeScript toolchain in the runtime image.
      'migrate-deploy': 'scripts/migrate-deploy.ts',
      'worker-observability-preload':
        'src/shared/observability/worker-observability-preload.ts',
    },
    outDir: 'dist-worker',
    format: ['esm'],
    target: 'node22',
    splitting: false,
    sourcemap: true,
    clean: true,
    esbuildOptions(options) {
      options.alias = { '#': './src' }
    },
    // Bare package names also match their subpath imports.
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
  },
  {
    // Local-stack-only executables stay in a separate output directory that
    // production images never copy.
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
  },
  {
    // Nitro does not emit an independent Node preload. clean:false preserves
    // the Vite output produced before tsup runs.
    entry: {
      'web-observability-preload':
        'src/shared/observability/web-observability-preload.ts',
    },
    outDir: '.output/server',
    format: ['esm'],
    target: 'node22',
    splitting: false,
    sourcemap: true,
    clean: false,
    outExtension: () => ({ js: '.mjs' }),
    esbuildOptions(options) {
      options.alias = { '#': './src' }
    },
    noExternal: [/^#/],
    external: ['@sentry/node', 'pino'],
    env: {
      NODE_ENV: process.env.NODE_ENV ?? 'production',
    },
  },
])
