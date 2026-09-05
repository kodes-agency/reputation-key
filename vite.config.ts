import tailwindcss from '@tailwindcss/vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { sentryTanstackStart } from '@sentry/tanstackstart-react/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { loadEnv, defineConfig, type Plugin } from 'vite'

/**
 * Zod v4 decides whether to use its JIT-compiled validator path by PROBING for
 * eval: `allowsEval` calls `new Function('')` once and falls back when it
 * throws. Our Content-Security-Policy deliberately omits `unsafe-eval`
 * (shared/security/security-headers.ts), so the probe was blocked on every
 * page load and the browser reported a policy violation. Nothing broke — Zod
 * took the interpreted path, which is the path this CSP wants — but a public
 * guest surface reported a CSP violation on every visit, which trains
 * operators to ignore CSP reports and is exactly the noise a real injection
 * would hide in.
 *
 * Zod reads `globalConfig.jitless` BEFORE touching `allowsEval`, and its own
 * source says so ("Skip the probe under `jitless`: strict CSPs report the
 * caught `new Function` as a `securitypolicyviolation`"). Setting it from
 * application code loses a race it cannot win: `globalConfig.jitless` is read
 * when a schema is CONSTRUCTED, and module-scope schemas in imported chunks
 * evaluate before any entry-point statement. Appending it to the module that
 * CREATES `globalConfig` is ordered by construction rather than by import
 * graph, so it holds for every schema in every chunk.
 */
function zodJitlessPlugin(): Plugin {
  return {
    name: 'repkey-zod-jitless',
    enforce: 'pre',
    transform(code: string, id: string) {
      if (!id.includes('zod/v4/core/core.js')) return null
      if (!code.includes('globalConfig')) return null
      return { code: `${code}\nglobalConfig.jitless = true;\n`, map: null }
    },
  }
}

const config = defineConfig(({ mode }) => {
  // Load .env into process.env before any server module runs.
  // Vite's loadEnv populates process.env for the current mode.
  loadEnv(mode, process.cwd(), '')

  // Nitro plugin is only needed for production builds (Sentry externalization).
  // During dev, Nitro creates a dispatchFetch environment that prevents
  // TanStack Start's dev server middleware from installing, which breaks
  // server function routing and client hydration.
  const isBuild = mode === 'production'
  // Storybook runs its own Vite — skip the TanStack Start + Nitro + devtools
  // plugins which assume the full app server and break the Storybook build
  // (storybook#33747). Keep tailwindcss, tsconfigPaths, and viteReact.
  const isStorybook =
    !!process.env.STORYBOOK || process.argv.slice(1).some((a) => a.includes('storybook'))
  // BQC-6.4: Playwright's webServer sets E2E=1. Under e2e, disable the
  // devtools console-pipe — it mirrors browser console into the server
  // terminal (and server logs back into the browser via SSE), so one client
  // console.error multiplies into unbounded [Client]/[Server] echo on stderr,
  // which Playwright pipes into the CI job log. Local `pnpm dev` (no flag)
  // keeps the pipe for DX.
  const isE2E = !!process.env.E2E
  if (isBuild && !isStorybook && !process.env.SENTRY_AUTH_TOKEN) {
    console.warn('[sentry] SENTRY_AUTH_TOKEN is unset; skipping source-map upload')
  }

  return {
    environments: {
      client: {
        build: {
          sourcemap: 'hidden',
          rolldownOptions: {
            output: {
              codeSplitting: {
                groups: [
                  {
                    name: 'vendor-react',
                    test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
                    priority: 40,
                    includeDependenciesRecursively: false,
                  },
                  {
                    // `includeDependenciesRecursively` MUST stay false: with it
                    // on, recharts' transitive deps (clsx,
                    // use-sync-external-store, redux, es-toolkit) join this
                    // group, so any module needing clsx statically imports the
                    // whole 117 KiB chart vendor on first paint.
                    name: 'vendor-charts',
                    test: /node_modules[\\/](?:recharts|d3-|victory-vendor)/,
                    priority: 30,
                    includeDependenciesRecursively: false,
                  },
                  {
                    name: 'vendor-dnd',
                    test: /node_modules[\\/]@dnd-kit/,
                    priority: 30,
                    includeDependenciesRecursively: false,
                  },
                  {
                    name: 'app-shared',
                    test: /[\\/]src[\\/](?:components|contexts)[\\/]/,
                    priority: 10,
                    minShareCount: 2,
                    entriesAwareMergeThreshold: 4 * 1024,
                    entriesAware: true,
                    includeDependenciesRecursively: false,
                  },
                ],
              },
            },
          },
        },
      },
    },
    resolve: { tsconfigPaths: true },
    plugins: [
      zodJitlessPlugin(),
      ...(isStorybook ? [] : [devtools({ consolePiping: { enabled: !isE2E } })]),
      ...(isBuild && !isStorybook
        ? [
            nitro({
              // `cld3-asm` ships emscripten glue whose loader expects to be
              // called as a CJS factory; bundling it produces
              // `runtimeModule is not a function` at the first
              // `loadModule()` — reply drafting's language verifier. The
              // manifest pins the package by sha256 under `node_modules`
              // (ai-reply-language-verifier-v1.manifest.json), so runtime
              // resolution is the attested path, not a workaround.
              rollupConfig: {
                // Keep the Node SDK external so the preload, Nitro hook and
                // bundled TanStack middleware share one runtime SDK instance.
                // The TanStack wrapper itself is build-only and must remain
                // bundled; externalizing all @sentry packages would ship its
                // source-map uploader and @sentry/cli in production deps.
                external: [/^@sentry\/node(?:\/|$)/, /^cld3-asm(\/|$)/],
              },
              // serverDir scanning stays off (default false under TanStack
              // Start), so this explicit list is the ONLY plugin registration
              // path. Wired plugins (init order):
              //   - production-secret-guard (BQC-7.6): refuse boot when a
              //     known placeholder/test secret leaks into production.
              //   - error-monitoring (OBS-01): capture unexpected Nitro errors;
              //     Node --import preloads the SDK before any plugin starts.
              //   - release-identity-guard: refuse a declared candidate that
              //     differs from the revision baked into the image.
              //   - restore-mode-guard (BQC-7.8): restore-isolated boot
              //     assertion + the loud RESTORE MODE ISOLATED log line; the
              //     capability fail-closed enforcement itself lives at the
              //     beta-capabilities evaluation seam (per-request).
              //   - redis-runtime-guard (DATA-18): require physically separate
              //     cache/queue Redis and prove the queue runtime contract
              //     before the web producer accepts traffic.
              //   - graceful-shutdown (BQC-7.1): close pg/Redis/BullMQ on
              //     SIGTERM so the process exits inside the drain window.
              //   - security-headers (BQC-7.6, STD-P1-07): the B0.7 header set
              //     on every response; the previous nitropack-v2 version of
              //     this plugin was inert. Proven against the booted artifact
              //     by scripts/check-security-headers.mjs (CI).
              //   - request-guard (BQC-7.6): 413 body-size limit (fail before
              //     routing) + x-request-id on every response.
              plugins: [
                'server/plugins/production-secret-guard.ts',
                'server/plugins/error-monitoring.ts',
                'server/plugins/release-identity-guard.ts',
                'server/plugins/restore-mode-guard.ts',
                'server/plugins/redis-runtime-guard.ts',
                'server/plugins/graceful-shutdown.ts',
                'server/plugins/security-headers.ts',
                'server/plugins/request-guard.ts',
              ],
            }),
          ]
        : []),
      tailwindcss(),
      // Import protection prevents server-only modules (Node builtins, DB
      // drivers, the composition root, API routes, repositories) from leaking
      // into the client bundle — which crashes hydration with
      // "Module X has been externalized for browser compatibility" errors.
      // In dev, violations are mocked (recursive Proxy); in build, they error.
      // See TanStack Start docs → "Import Protection".
      //
      // Server functions (src/contexts/*/server/**) are NOT denied: TanStack
      // RPC-stubs them for the client, and that transform strips their
      // server-only imports, so denying them would only break the RPC stubs.
      ...(isStorybook
        ? []
        : [
            tanstackStart({
              importProtection: {
                client: {
                  files: [
                    '**/*.server.*',
                    '**/routes/api/**',
                    '**/composition.ts',
                    '**/infrastructure/**',
                    '**/build.ts',
                    '**/shared/db/**',
                    '**/shared/cache/**',
                    // react-email .tsx templates — server-render only.
                    '**/shared/email/**',
                    '**/shared/jobs/**',
                    '**/shared/observability/**',
                    '**/shared/auth/auth.ts',
                    '**/shared/auth/middleware.ts',
                    '**/shared/auth/server-errors.ts',
                    '**/shared/auth/headers.ts',
                  ],
                  excludeFiles: [
                    '**/node_modules/**',
                    // Exact browser-safe exceptions: the scrubbers and browser
                    // exception sink are pure, and TanStack RPC-stubs the server
                    // function before its imports enter the client graph.
                    '**/shared/observability/sentry-event-scrub.ts',
                    '**/shared/observability/sensitive-field-policy.ts',
                    '**/shared/observability/browser-exception-capture.ts',
                    '**/shared/observability/browser-observability.server.ts',
                  ],
                },
              },
            }),
          ]),
      ...(isBuild && !isStorybook && process.env.SENTRY_AUTH_TOKEN
        ? sentryTanstackStart({
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            authToken: process.env.SENTRY_AUTH_TOKEN,
            release: { name: process.env.SOURCE_REVISION },
            sourcemaps: {
              filesToDeleteAfterUpload: ['./.output/**/*.map'],
            },
            telemetry: false,
          })
        : []),
      viteReact(),
    ],
  }
})

export default config
