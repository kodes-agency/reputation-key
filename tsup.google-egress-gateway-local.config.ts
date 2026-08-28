import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'services/google-egress-gateway/entry.ts',
    'control-proxy': 'services/google-egress-gateway/control-proxy.ts',
    'tcp-relay': 'services/google-egress-gateway/tcp-relay.ts',
  },
  outDir: 'dist-google-egress-gateway-local',
  format: ['esm'],
  target: 'node22',
  splitting: false,
  sourcemap: false,
  clean: true,
  noExternal: [/.*/],
  env: {
    NODE_ENV: 'development',
  },
  define: {
    __REPKEY_GOOGLE_LOCAL_SANDBOX__: 'true',
  },
})
