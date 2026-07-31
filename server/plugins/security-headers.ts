// Nitro plugin: security headers on every HTTP response (B0.7, STD-P1-07).
//
// STD-P1-07 history: this file was originally written against the nitropack
// v2 API ('nitropack/server', the 'beforeResponse' hook, event.node.res) while
// the project builds with nitro v3 ('nitro/vite') — and nitro's serverDir
// scanning stays off under TanStack Start, so the file was never even loaded.
// Production responses carried no B0.7 headers.
//
// Repair (BQC-7.6): the file is now a thin wiring shim registered explicitly
// in the vite.config.ts nitro `plugins` array (the ONLY registration path),
// delegating to the v3-compatible plugin in src/shared/security/ — the single
// source of truth for the header set, unit-tested there. The wiring is pinned
// by src/shared/architecture/security-headers-wiring.test.ts and proven
// end-to-end against the booted production artifact by
// scripts/check-security-headers.mjs (CI gate).

import { definePlugin } from 'nitro'
import { securityHeadersPlugin } from '#/shared/security/security-headers'

export default definePlugin(securityHeadersPlugin)
