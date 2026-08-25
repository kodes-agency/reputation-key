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

function isPrivateDestinationHost(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/gu, '')
    .replace(/\.$/u, '')
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.lan') ||
    host.endsWith('.home') ||
    host.endsWith('.home.arpa') ||
    host.endsWith('.invalid') ||
    host.endsWith('.test') ||
    host.endsWith('.example') ||
    host.endsWith('.onion')
  ) {
    return true
  }

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(host)
  if (ipv4) {
    const [first, second] = ipv4.slice(1).map(Number)
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      first >= 224
    )
  }

  if (!host.includes(':')) return !host.includes('.')
  return (
    host === '::' ||
    host === '::1' ||
    /^f[cd]/u.test(host) ||
    /^fe[89ab]/u.test(host) ||
    /^ff/u.test(host) ||
    /^::ffff:(?:0\.|10\.|127\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.)/u.test(
      host,
    )
  )
}

/** General link-tree boundary: arbitrary public HTTPS is allowed, local targets are not. */
export function isPublicHttpsDestination(url: string): boolean {
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/u.test(url)) return false
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === 'https:' &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.hostname !== '' &&
      !isPrivateDestinationHost(parsed.hostname)
    )
  } catch {
    return false
  }
}

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

  // Must not be a private/internal address or local-only name.
  const host = parsed.hostname
  if (isPrivateDestinationHost(host)) {
    return { valid: false, error: { code: 'is_private_ip', url, host } }
  }

  // Check for open-redirect patterns (double-scheme, //evil.com)
  if (url.includes('://') && url.indexOf('://') !== url.lastIndexOf('://')) {
    return { valid: false, error: { code: 'has_open_redirect_pattern', url } }
  }

  // Must be in the allowlist
  const isInAllowlist = allowlist.some((entry) => {
    if (entry.host !== host) return false
    if (entry.pathPrefix) {
      const prefix = entry.pathPrefix.endsWith('/')
        ? entry.pathPrefix.slice(0, -1)
        : entry.pathPrefix
      if (parsed.pathname !== prefix && !parsed.pathname.startsWith(`${prefix}/`)) {
        return false
      }
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
