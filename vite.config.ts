import tailwindcss from '@tailwindcss/vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { loadEnv, defineConfig } from 'vite'

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

  return {
    environments: {
      client: {
        build: {
          rolldownOptions: {
            output: {
              codeSplitting: {
                groups: [
                  {
                    name: 'vendor-charts',
                    test: /node_modules[\\/](?:recharts|d3-|victory-vendor)/,
                    priority: 30,
                  },
                  {
                    name: 'vendor-dnd',
                    test: /node_modules[\\/]@dnd-kit/,
                    priority: 30,
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
              rollupConfig: { external: [/^@sentry\//, /^cld3-asm(\/|$)/] },
              // serverDir scanning stays off (default false under TanStack
              // Start), so this explicit list is the ONLY plugin registration
              // path. Wired plugins (init order):
              //   - production-secret-guard (BQC-7.6): refuse boot when a
              //     known placeholder/test secret leaks into production.
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
                },
              },
            }),
          ]),
      viteReact(),
    ],
  }
})

export default config
