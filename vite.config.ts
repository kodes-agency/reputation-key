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

  return {
    resolve: { tsconfigPaths: true },
    plugins: [
      devtools(),
      nitro({ rollupConfig: { external: [/^@sentry\//] } }),
      tailwindcss(),
      tanstackStart(),
      viteReact(),
    ],
  }
})

export default config
