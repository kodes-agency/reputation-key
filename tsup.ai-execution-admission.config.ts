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
  // The banner's own imports are ALIASED. esbuild hoists a bundled module's
  // `import { createRequire } from 'module'` to the top of the output, next to
  // this banner — two top-level declarations of the same name, and the bundle
  // stops being parseable. That is exactly how the Google admission sidecar
  // shipped a container that exited 1 on `SyntaxError: Identifier
  // 'createRequire' has already been declared`. A name no source can use
  // cannot collide.
  banner: {
    js: "import { createRequire as __repkeyCreateRequire } from 'node:module'; const require = __repkeyCreateRequire(import.meta.url);",
  },
  esbuildOptions(options) {
    options.mainFields = ['main', 'module']
  },
})
