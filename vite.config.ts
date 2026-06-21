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

  return {
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-charts': ['recharts'],
            'vendor-dnd': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          },
        },
      },
    },
    resolve: { tsconfigPaths: true },
    plugins: [
      devtools(),
      ...(isBuild ? [nitro({ rollupConfig: { external: [/^@sentry\//] } })] : []),
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
      viteReact(),
    ],
  }
})

export default config
