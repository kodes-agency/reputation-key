// Nitro plugin: security headers on every HTTP response (B0.7).
//
// This file is auto-discovered by Nitro during production builds.
// It applies the security header set (CSP, HSTS, X-Frame-Options,
// X-Content-Type-Options, Referrer-Policy, Permissions-Policy)
// to every response via the `beforeResponse` lifecycle hook.
//
// BQC-5.8 classification: B (required control, wire in BQC-7). Nitro plugin
// discovery is currently inert under TanStack Start (STD-P1-07) — the file
// is reported as an unused file by fallow and suppressed via
// .fallowrc.json ignoreFindings. Owner: BQC-7. Expiry: BQC-7 close
// (wire the plugin or remove it).

import { defineNitroPlugin } from 'nitropack/server'
import { getSecurityHeaders } from '#/shared/security/security-headers'

export default defineNitroPlugin((nitroApp) => {
  const headers = getSecurityHeaders()

  nitroApp.hooks.hook('beforeResponse', (event) => {
    for (const [name, value] of Object.entries(headers)) {
      event.node.res.setHeader(name, value)
    }
  })
})
