import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'services/google-egress-gateway/entry.ts',
  },
  outDir: 'dist-google-egress-gateway',
  format: ['esm'],
  target: 'node22',
  splitting: false,
  sourcemap: false,
  clean: true,
  noExternal: [/.*/],
  env: {
    NODE_ENV: process.env.NODE_ENV ?? 'production',
  },
  define: {
    __REPKEY_GOOGLE_LOCAL_SANDBOX__: 'false',
  },
  esbuildOptions(options) {
    options.minifySyntax = true
  },
})
