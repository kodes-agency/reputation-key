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
    resolve: { tsconfigPaths: true },
    plugins: [
      devtools(),
      ...(isBuild ? [nitro({ rollupConfig: { external: [/^@sentry\//] } })] : []),
      tailwindcss(),
      tanstackStart(),
      viteReact(),
    ],
  }
})

export default config
