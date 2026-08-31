const GOOGLE_REVIEW_HOSTS = new Set([
  'business.google.com',
  'g.page',
  'maps.google.com',
  'search.google.com',
  'www.google.com',
])

const MAX_GOOGLE_REVIEW_URI_LENGTH = 2_048

/**
 * Validates the output-only Google Business Profile review URI before it can
 * become a Property-owned public destination. This is deliberately an exact
 * host allowlist: a provider response is still untrusted input.
 */
export function normalizeGoogleReviewDestination(value: string): string | null {
  if (
    value.length < 1 ||
    value.length > MAX_GOOGLE_REVIEW_URI_LENGTH ||
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1f\x7f]/u.test(value)
  ) {
    return null
  }
  try {
    const parsed = new URL(value)
    if (
      parsed.protocol !== 'https:' ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      !GOOGLE_REVIEW_HOSTS.has(parsed.hostname.toLowerCase())
    ) {
      return null
    }
    return parsed.toString()
  } catch {
    return null
  }
}
