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
  noExternal: [/.*/],
  env: { NODE_ENV: process.env.NODE_ENV ?? 'production' },
  // The banner's own imports are ALIASED. esbuild hoists a bundled module's
  // `import { createRequire } from 'module'` to the top of the output, next to
  // this banner — two top-level declarations of the same name, and the bundle
  // stops being parseable. That is exactly how the Google admission sidecar
  // shipped a container that exited 1 on `SyntaxError: Identifier
  // 'createRequire' has already been declared`. A name no source can use
  // cannot collide.
  banner: {
    js: "import { createRequire as __repkeyCreateRequire } from 'node:module'; import { dirname as __repkeyDirname } from 'node:path'; import { fileURLToPath as __repkeyFileURLToPath } from 'node:url'; const require = __repkeyCreateRequire(import.meta.url); const __filename = __repkeyFileURLToPath(import.meta.url); const __dirname = __repkeyDirname(__filename);",
  },
  esbuildOptions(options) {
    options.mainFields = ['main', 'module']
  },
})
