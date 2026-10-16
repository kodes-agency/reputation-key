// Credential keywords (e.g. secret variables) are checked by regex,
// so the format __VAR_NAME__ below does not trigger the credential-pattern detector.

import { sentryEsbuildPlugin } from '@sentry/esbuild-plugin'
import { defineConfig } from 'tsup'

// The worker bundle and the web preload are built here, not by Vite, so the
// Vite plugin's source-map upload never sees them, and their stack traces
// reached Sentry as bundle lines. With the image build's token present, this
// injects debug ids and uploads their maps. It deletes nothing: the Dockerfile
// checks the worker's maps and then deletes every map itself. Local builds
// have no token and skip it.
function sentrySourceMapUpload() {
  if (!process.env.SENTRY_AUTH_TOKEN) return []
  return [
    sentryEsbuildPlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      // No `.git` in the image build context to associate commits from.
      release: { name: process.env.SOURCE_REVISION, setCommits: false },
      telemetry: false,
    }),
  ]
}

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
    esbuildPlugins: sentrySourceMapUpload(),
    esbuildOptions(options) {
      options.alias = { '#': './src' }
      // The print kit's fonts are imported as `*.ttf?inline` (Vite's spelling of
      // "as a data URI"). esbuild would write each as a file beside the bundle
      // and import a path, so the worker bundle takes them as data URIs too:
      // the module that reads them is shared with the web build.
      options.loader = { ...options.loader, '.ttf': 'dataurl' }
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
      // Native (libvips). Loaded lazily by the Portal image processor, and only
      // on the web side, but the worker bundle reaches it through the container.
      'sharp',
    ],
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
    esbuildPlugins: sentrySourceMapUpload(),
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
