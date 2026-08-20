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
  /** Per-response nonce for scripts rendered by the application shell. */
  readonly cspNonce?: string
  /** Browser upload endpoints permitted by connect-src. URLs are reduced to origins. */
  readonly connectSources?: readonly string[]
}

const CSP_NONCE_PATTERN = /^[A-Za-z0-9+/_-]+={0,2}$/

function getScriptSource(cspNonce: string | undefined): string {
  if (!cspNonce) {
    return "'self'"
  }

  if (!CSP_NONCE_PATTERN.test(cspNonce)) {
    throw new Error('CSP nonce must be a base64 value')
  }

  return `'self' 'nonce-${cspNonce}'`
}

function configuredStorageConnectSources(): readonly string[] {
  if (process.env.S3_PRESIGN_ENDPOINT) {
    return [process.env.S3_PRESIGN_ENDPOINT]
  }

  const bucket = process.env.AWS_S3_BUCKET_NAME
  const region = process.env.AWS_S3_REGION
  if (!bucket || !region) return []

  return process.env.S3_FORCE_PATH_STYLE?.toLowerCase() === 'true'
    ? [`https://s3.${region}.amazonaws.com`]
    : [`https://${bucket}.s3.${region}.amazonaws.com`]
}

function getConnectSource(opts: SecurityHeadersOptions | undefined): string {
  const sources = opts?.connectSources ?? configuredStorageConnectSources()
  const origins = sources.map((source) => {
    let url: URL
    try {
      url = new URL(source)
    } catch {
      throw new Error('CSP connect source must be an absolute HTTP(S) URL')
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('CSP connect source must use HTTP(S)')
    }
    return url.origin
  })
  return ["'self'", ...new Set(origins)].join(' ')
}

/**
 * Build the security header set for all responses.
 *
 * CSP is default-deny: same-origin scripts plus an optional per-response
 * script nonce, inline styles (required by Vite/TanStack injected style tags),
 * trusted font stylesheets and font assets, same-origin + data + https images,
 * same-origin connects, no framing, no third-party bases/forms.
 *
 * HSTS is included only when `isProduction` is true — never in dev/test to
 * avoid locking localhost into HTTPS during local development.
 */
export function getSecurityHeaders(
  opts?: SecurityHeadersOptions,
): Readonly<Record<string, string>> {
  const isProduction = opts?.isProduction ?? process.env.NODE_ENV === 'production'

  const scriptSource = getScriptSource(opts?.cspNonce)
  const connectSource = getConnectSource(opts)

  const headers: Record<string, string> = {
    'Content-Security-Policy': [
      `script-src ${scriptSource}`,
      "style-src 'self' 'unsafe-inline' https://api.fontshare.com https://fonts.googleapis.com",
      "img-src 'self' data: https:",
      `connect-src ${connectSource}`,
      "font-src 'self' https://cdn.fontshare.com https://fonts.gstatic.com",
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
 * Wired explicitly in the `vite.config.ts` Nitro `plugins` array; TanStack
 * Start leaves serverDir scanning off. Its request middleware attaches a
 * unique nonce to router responses before this plugin supplies static headers
 * for all other responses.
 *
 * STD-P1-07 (BQC-7.6): the previous nitropack-v2 plugin was inert; this v3
 * plugin is the repaired mechanism, pinned by
 * src/shared/architecture/security-headers-wiring.test.ts and proven against
 * the booted artifact by scripts/check-security-headers.mjs.
 */
export const securityHeadersPlugin: NitroAppPlugin = (nitroApp) => {
  nitroApp.hooks.hook('response', (res) => {
    applySecurityHeaders(res.headers)
  })
}
