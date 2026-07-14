// Security response headers — B0.7 hardening of the web/request boundary.
//
// Default-deny CSP, transport security (production only), and standard
// hardening headers applied to every HTTP response. The pure header builder
// is the single source of truth; the Nitro plugin wires it into the production
// server lifecycle.

import type { NitroAppPlugin } from 'nitro/types'

/** Options for {@link getSecurityHeaders}. */
export interface SecurityHeadersOptions {
  /** Override production detection (defaults to NODE_ENV === 'production'). */
  readonly isProduction?: boolean
}

/**
 * Build the security header set for all responses.
 *
 * CSP is default-deny: only same-origin scripts, inline styles (required by
 * Vite/TanStack injected style tags), same-origin + data + https images,
 * same-origin connects/fonts, no framing, no third-party bases/forms.
 *
 * HSTS is included only when `isProduction` is true — never in dev/test to
 * avoid locking localhost into HTTPS during local development.
 */
export function getSecurityHeaders(
  opts?: SecurityHeadersOptions,
): Readonly<Record<string, string>> {
  const isProduction = opts?.isProduction ?? process.env.NODE_ENV === 'production'

  const headers: Record<string, string> = {
    'Content-Security-Policy': [
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "font-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  }

  if (isProduction) {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
  }

  return headers
}

/**
 * Apply security headers to a `Headers` object. Merges without overwriting
 * caller-set values so a caller can deliberately override (e.g. CSP report-only).
 */
export function applySecurityHeaders(
  headers: Headers,
  opts?: SecurityHeadersOptions,
): void {
  for (const [name, value] of Object.entries(getSecurityHeaders(opts))) {
    if (!headers.has(name)) {
      headers.set(name, value)
    }
  }
}

/**
 * Nitro plugin that sets security headers on every response via the `response`
 * lifecycle hook. Compatible with TanStack Start's production Nitro server.
 *
 * Register in `nitro/plugins/` or wire explicitly. For dev mode (where Nitro
 * is not active), call {@link applySecurityHeaders} from TanStack Start router
 * middleware instead.
 */
export const securityHeadersPlugin: NitroAppPlugin = (nitroApp) => {
  nitroApp.hooks.hook('response', (res) => {
    for (const [name, value] of Object.entries(getSecurityHeaders())) {
      res.headers.set(name, value)
    }
  })
}

export default securityHeadersPlugin
