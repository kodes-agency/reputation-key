// Absolute URL builder for outbound email.
//
// Email has no document base: every href MUST be absolute or the link is dead
// in the client. Before this module three call sites concatenated
// `${env.BETTER_AUTH_URL}/accept-invitation?id=${id}` by hand, which silently
// produced `https://app.example.com//accept-invitation` whenever the base
// carried a trailing slash and never encoded the id.
//
// `path` is a route path, not a URL: it must NOT carry its own query string —
// pass query parameters through `search` so they are encoded exactly once.

/**
 * Join an origin (or origin + path prefix) with a route path and an optional,
 * properly encoded query string.
 *
 * Trailing slashes on `baseUrl` and a missing leading slash on `path` are both
 * normalised, so `absoluteUrl('https://a.test/', 'x')` and
 * `absoluteUrl('https://a.test', '/x')` agree.
 *
 * Query parameters are emitted in insertion order so the output is stable and
 * assertable in tests.
 */
export const absoluteUrl = (
  baseUrl: string,
  path: string,
  search?: Readonly<Record<string, string>>,
): string => {
  const base = baseUrl.replace(/\/+$/, '')
  const route =
    path === '' || path === '/' ? '' : path.startsWith('/') ? path : `/${path}`
  const entries = Object.entries(search ?? {})
  if (entries.length === 0) return `${base}${route}`
  const query = entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
  return `${base}${route}?${query}`
}

/**
 * The origin of an absolute URL, or `null` when it cannot be parsed.
 *
 * Used to derive sibling links (e.g. the digest's "Open inbox" button) from a
 * URL the caller already supplied, rather than widening a ratified render
 * contract with a second base-URL argument.
 */
export const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}
