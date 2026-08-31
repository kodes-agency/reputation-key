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
  // The banner's own imports are ALIASED. esbuild hoists a bundled module's
  // `import { createRequire } from 'module'` to the top of the output, next to
  // this banner — two top-level declarations of the same name, and the bundle
  // stops being parseable.
  //
  // The banner is needed at all because this graph reaches
  // `require-in-the-middle` through OpenTelemetry's instrumentation, which
  // calls `require('path')` at load. An ESM bundle has no `require`, so
  // esbuild emits a shim that throws `Dynamic require of "path" is not
  // supported` — which is how this sidecar exited 1 before a single request.
  banner: {
    js: "import { createRequire as __repkeyCreateRequire } from 'node:module'; const require = __repkeyCreateRequire(import.meta.url);",
  },
  esbuildOptions(options) {
    options.minifySyntax = true
  },
})
