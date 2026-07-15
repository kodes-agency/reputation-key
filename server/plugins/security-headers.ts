// Nitro plugin: security headers on every HTTP response (B0.7).
//
// This file is auto-discovered by Nitro during production builds.
// It applies the security header set (CSP, HSTS, X-Frame-Options,
// X-Content-Type-Options, Referrer-Policy, Permissions-Policy)
// to every response via the `beforeResponse` lifecycle hook.

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
