// POST-BETA-2 PB2.1: Safe link validation.
//
// Per ADR 0044: only allowlisted HTTPS provider URLs may be opened
// after server validation. Never accept an arbitrary redirect target
// from query/body input. Reject unsafe schemes, credentials, control
// characters, and open-redirect patterns.

export type LinkValidationError =
  | { code: 'invalid_scheme'; url: string }
  | { code: 'not_https'; url: string }
  | { code: 'has_credentials'; url: string }
  | { code: 'has_control_chars'; url: string }
  | { code: 'not_in_allowlist'; url: string; host: string }
  | { code: 'is_private_ip'; url: string; host: string }
  | { code: 'has_open_redirect_pattern'; url: string }

export interface LinkAllowlistEntry {
  readonly host: string
  readonly pathPrefix?: string
}

// Known-safe Google review destinations
const DEFAULT_ALLOWLIST: readonly LinkAllowlistEntry[] = [
  { host: 'www.google.com', pathPrefix: '/maps' },
  { host: 'www.google.com', pathPrefix: '/search' },
  { host: 'search.google.com' },
  { host: 'maps.google.com' },
  { host: 'business.google.com' },
]

// Private/internal IP ranges that should never be linked to
const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^localhost$/i,
]

export function validateExternalLink(
  url: string,
  allowlist: readonly LinkAllowlistEntry[] = DEFAULT_ALLOWLIST,
): { valid: true; parsed: URL } | { valid: false; error: LinkValidationError } {
  // Check for control characters (intentional — we detect them to reject)
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(url)) {
    return { valid: false, error: { code: 'has_control_chars', url } }
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { valid: false, error: { code: 'invalid_scheme', url } }
  }

  // Must be HTTPS
  if (parsed.protocol !== 'https:') {
    return { valid: false, error: { code: 'not_https', url } }
  }

  // Must not contain credentials
  if (parsed.username || parsed.password) {
    return { valid: false, error: { code: 'has_credentials', url } }
  }

  // Must not be a private/internal address
  const host = parsed.hostname
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(host)) {
      return { valid: false, error: { code: 'is_private_ip', url, host } }
    }
  }

  // Check for open-redirect patterns (double-scheme, //evil.com)
  if (url.includes('://') && url.indexOf('://') !== url.lastIndexOf('://')) {
    return { valid: false, error: { code: 'has_open_redirect_pattern', url } }
  }

  // Must be in the allowlist
  const isInAllowlist = allowlist.some((entry) => {
    if (entry.host !== host) return false
    if (entry.pathPrefix && !parsed.pathname.startsWith(entry.pathPrefix)) {
      return false
    }
    return true
  })

  if (!isInAllowlist) {
    return { valid: false, error: { code: 'not_in_allowlist', url, host } }
  }

  return { valid: true, parsed }
}

export function getDefaultAllowlist(): readonly LinkAllowlistEntry[] {
  return DEFAULT_ALLOWLIST
}
