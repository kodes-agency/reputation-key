import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'local-provider-entry': 'services/ai-egress-gateway/local-provider-entry.ts',
  },
  outDir: 'dist-ai-egress-gateway-local',
  format: ['esm'],
  target: 'node22',
  splitting: false,
  sourcemap: false,
  clean: true,
  noExternal: [
    /^#\//,
    'openai',
    'undici',
    'zod',
    'cld3-asm',
    'libphonenumber-js',
    'emscripten-wasm-loader',
    'getroot',
    'nanoid',
    'unixify',
  ],
  env: { NODE_ENV: 'development' },
  banner: {
    js: "import { createRequire } from 'node:module'; import { dirname } from 'node:path'; import { fileURLToPath } from 'node:url'; const require = createRequire(import.meta.url); const __filename = fileURLToPath(import.meta.url); const __dirname = dirname(__filename);",
  },
  esbuildOptions(options) {
    options.mainFields = ['main', 'module']
  },
})
