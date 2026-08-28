import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'services/ai-execution-admission/entry.ts',
  },
  outDir: 'dist-ai-execution-admission',
  format: ['esm'],
  target: 'node22',
  splitting: false,
  sourcemap: false,
  clean: true,
  noExternal: [/.*/],
  external: ['pg-native', 'pg-cloudflare'],
  env: {
    NODE_ENV: process.env.NODE_ENV ?? 'production',
  },
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  esbuildOptions(options) {
    options.mainFields = ['main', 'module']
  },
})
