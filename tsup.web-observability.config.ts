import { defineConfig } from 'tsup'

// The web start command must be runnable after `pnpm build` alone. Nitro does
// not emit an independent Node preload, so bundle the shared privacy/runtime
// policy beside its server entry after Vite finishes. clean:false preserves
// the Nitro output created by the first half of the build script.
export default defineConfig({
  entry: {
    'web-observability-preload': 'src/shared/observability/web-observability-preload.ts',
  },
  outDir: '.output/server',
  format: ['esm'],
  target: 'node22',
  splitting: false,
  sourcemap: true,
  clean: false,
  outExtension: () => ({ js: '.mjs' }),
  alias: {
    '#': './src',
  },
  noExternal: [/^#/],
  external: ['@sentry/node', 'pino'],
  env: {
    NODE_ENV: process.env.NODE_ENV ?? 'production',
  },
})
