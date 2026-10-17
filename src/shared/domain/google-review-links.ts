// Where a manager can open a Google review: the review's own Business Profile
// page, or, when there is none, the Property's public reviews on Google.
//
// Both values are provider data and untrusted input. Neither is ever built from
// an identifier RepKey holds: the per-review token is not derivable from the
// review's id, and the place id comes only from a destination the Property has
// verified (src/contexts/property/domain/google-review-destination.ts).

/** The longest `reviewReplyUrl` the review adapter reads (GBP API v4.9). */
export const MAX_GOOGLE_REVIEW_REPLY_URL_LENGTH = 2_048

const BUSINESS_PROFILE_ORIGIN = 'https://business.google.com'

/** A provider resource segment, as `review-provider-subject-contract` reads one. */
const LOCATION_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,254}$/u

/** Google's opaque, URL-safe base64 review token (about 68 characters today). */
const REVIEW_TOKEN = /^[A-Za-z0-9_-]{1,512}$/u

/**
 * Google's output-only `reviewReplyUrl` ("URL for replying to the review"), or
 * null for anything else.
 *
 * Accepted only in the one shape Google sends, matched as text rather than
 * parsed: `https://business.google.com/n/{location}/reviews/{token}`, where the
 * location is the one in the review's own resource name. Nothing is normalized,
 * so what is stored is what Google sent, and a URL parser cannot read anything
 * into it — no userinfo, port, query, fragment, dot segment, backslash,
 * percent-encoding, whitespace or control character gets past the exact prefix
 * and the token alphabet. The page is the merchant view: Google sends a
 * signed-out reader to sign in.
 */
export function normalizeGoogleReviewReplyUrl(
  value: string,
  expectedLocationId: string,
): string | null {
  if (value.length < 1 || value.length > MAX_GOOGLE_REVIEW_REPLY_URL_LENGTH) return null
  if (!LOCATION_SEGMENT.test(expectedLocationId)) return null
  const prefix = `${BUSINESS_PROFILE_ORIGIN}/n/${expectedLocationId}/reviews/`
  if (!value.startsWith(prefix)) return null
  return REVIEW_TOKEN.test(value.slice(prefix.length)) ? value : null
}

const WRITE_REVIEW_HOST = 'search.google.com'
const WRITE_REVIEW_PATH = '/local/writereview'
const PLACE_ID = /^[A-Za-z0-9_-]{1,512}$/u

/**
 * The public page that lists a place's reviews on Google, from the Property's
 * write-a-review destination (`https://search.google.com/local/writereview
 * ?placeid=…`), or null when the destination is in any other form. It opens
 * signed out, so it is the fallback when a review has no page of its own.
 *
 * The caller decides that the destination may be used at all: only a
 * `verified` one is ever rendered (Property CONTEXT, invariant 2).
 */
export function googleReviewsPageForDestination(destinationUri: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(destinationUri)
  } catch {
    return null
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.host !== WRITE_REVIEW_HOST ||
    parsed.pathname !== WRITE_REVIEW_PATH ||
    parsed.username !== '' ||
    parsed.password !== ''
  ) {
    return null
  }
  const placeIds = parsed.searchParams.getAll('placeid')
  const placeId = placeIds.length === 1 ? placeIds[0] : undefined
  if (placeId === undefined || !PLACE_ID.test(placeId)) return null
  return `https://${WRITE_REVIEW_HOST}/local/reviews?placeid=${placeId}`
}
