import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'verify-runtime-assets': 'scripts/verify-ai-gateway-runtime-assets.ts',
  },
  outDir: 'dist-ai-egress-gateway-assets-test',
  format: ['esm'],
  target: 'node22',
  splitting: false,
  sourcemap: false,
  clean: true,
  noExternal: [
    /^#\//,
    'cld3-asm',
    'emscripten-wasm-loader',
    'getroot',
    'nanoid',
    'unixify',
  ],
  env: { NODE_ENV: 'production' },
  banner: {
    js: "import { createRequire } from 'node:module'; import { dirname } from 'node:path'; import { fileURLToPath } from 'node:url'; const require = createRequire(import.meta.url); const __filename = fileURLToPath(import.meta.url); const __dirname = dirname(__filename);",
  },
  esbuildOptions(options) {
    options.mainFields = ['main', 'module']
  },
})
