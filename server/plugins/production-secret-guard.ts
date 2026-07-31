// Nitro plugin: production placeholder-secret boot guard (BQC-7.6).
//
// Refuses web-process boot when any secret matches the known placeholder/test
// family (test-environment.ts / CI / .env.example values) while NODE_ENV is
// production — a deployment on public-knowledge secrets produces forgeable
// sessions and decryptable tokens. Throws during plugin init, so the process
// never accepts traffic. Registered FIRST in the vite.config.ts plugins
// array (serverDir scanning stays off under TanStack Start — the array is
// the ONLY registration path). Logic + tests: src/shared/config/
// production-secrets.ts. The worker process runs the same assertion in
// src/worker/index.ts.
//
// Note: scripts/check-security-headers.mjs boots the artifact with per-run
// random secrets, so the CI gate is unaffected by this guard.

import { definePlugin } from 'nitro'
import { getEnv } from '#/shared/config/env'
import { assertProductionSecrets } from '#/shared/config/production-secrets'

export default definePlugin(() => {
  assertProductionSecrets(getEnv())
})
