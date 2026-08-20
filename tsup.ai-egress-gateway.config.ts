import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'services/ai-egress-gateway/index.ts',
    canary: 'services/ai-egress-gateway/canary-entry.ts',
  },
  outDir: 'dist-ai-egress-gateway',
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
  env: { NODE_ENV: process.env.NODE_ENV ?? 'production' },
  banner: {
    js: "import { createRequire } from 'node:module'; import { dirname } from 'node:path'; import { fileURLToPath } from 'node:url'; const require = createRequire(import.meta.url); const __filename = fileURLToPath(import.meta.url); const __dirname = dirname(__filename);",
  },
  esbuildOptions(options) {
    options.mainFields = ['main', 'module']
  },
})
