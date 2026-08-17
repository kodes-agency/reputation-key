import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'services/ai-execution-admission/index.ts',
  },
  outDir: 'dist-ai-execution-admission',
  format: ['esm'],
  target: 'node22',
  splitting: false,
  sourcemap: false,
  clean: true,
  noExternal: [
    /^#/,
    'pg',
    'pg-connection-string',
    'pg-pool',
    'pg-protocol',
    'pg-types',
    'pgpass',
    'postgres-array',
    'postgres-bytea',
    'postgres-date',
    'postgres-interval',
    'split2',
    'xtend',
    'zod',
  ],
  external: ['pg-native', 'pg-cloudflare'],
  env: {
    NODE_ENV: process.env.NODE_ENV ?? 'production',
  },
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  esbuildOptions(options) {
    options.mainFields = ['main', 'module']
  },
})
