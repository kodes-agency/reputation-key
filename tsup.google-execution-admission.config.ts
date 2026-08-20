import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'services/google-execution-admission/index.ts',
  },
  outDir: 'dist-google-execution-admission',
  format: ['esm'],
  target: 'node22',
  splitting: false,
  sourcemap: true,
  clean: true,
  noExternal: [/^#/],
  external: ['pg', 'ioredis', 'zod'],
  env: {
    NODE_ENV: process.env.NODE_ENV ?? 'production',
  },
})
