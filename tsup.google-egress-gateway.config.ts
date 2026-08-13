import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'services/google-egress-gateway/index.ts',
  },
  outDir: 'dist-google-egress-gateway',
  format: ['esm'],
  target: 'node22',
  splitting: false,
  sourcemap: true,
  clean: true,
  noExternal: [/^#/],
  external: ['zod'],
  env: {
    NODE_ENV: process.env.NODE_ENV ?? 'production',
  },
})
