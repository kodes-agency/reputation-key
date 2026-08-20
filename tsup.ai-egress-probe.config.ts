import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'runtime-egress-probe': 'services/ai-egress-gateway/runtime-egress-probe.ts',
  },
  outDir: 'dist-ai-egress-probe',
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
  env: { NODE_ENV: 'production' },
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  esbuildOptions(options) {
    options.mainFields = ['main', 'module']
  },
})
