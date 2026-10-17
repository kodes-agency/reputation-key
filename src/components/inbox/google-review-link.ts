// Where the Inbox sends a manager to see a review on Google, and the words for it.
//
// The server decides both links (`get-inbox-item-detail.ts`): the review's own
// Business Profile page when Google gave one and the review is still eligible
// to serve, and the Property's public reviews page otherwise, when the Property
// holds a verified destination. This module only picks between them in that
// order, and refuses to render anything that is not an https link to the one
// Google host each kind comes from — the server's validators are the authority
// (`#/shared/domain/google-review-links`), this is the last check before an
// `href`.

import type { InboxItemDetailResult } from '#/contexts/inbox/application/public-api'

export type GoogleReviewLink = Readonly<{
  /**
   * `review`: the review's own page on the Business Profile, which Google opens
   * only for the account that manages the profile. `property`: the Property's
   * public reviews on Google, which opens signed out.
   */
  kind: 'review' | 'property'
  href: string
}>

const GOOGLE_LINK_HOST: Readonly<Record<GoogleReviewLink['kind'], string>> = {
  review: 'business.google.com',
  property: 'search.google.com',
}

export const GOOGLE_REVIEW_LINK_COPY = {
  review: 'Open on Google',
  property: 'See reviews on Google',
  signInHint:
    'Google may ask you to sign in with the account that manages this Business Profile.',
  newTab: '(opens in a new tab)',
  /** For RepKey's sentence link when it falls back: they say "the review". */
  propertyNewTab: "(this property's reviews, opens in a new tab)",
} as const

/**
 * The words RepKey's own sentences use to send a manager to Google
 * (`reply-state-copy.ts`, `reply-check-feedback.ts`). They become the link when
 * there is one; with no link the sentence stays as it is, plain text.
 */
export const LOOK_AT_THE_REVIEW_ON_GOOGLE = 'look at the review on Google'

function isGoogleHref(href: string, kind: GoogleReviewLink['kind']): boolean {
  try {
    const url = new URL(href)
    return url.protocol === 'https:' && url.host === GOOGLE_LINK_HOST[kind]
  } catch {
    return false
  }
}

/** The review's own page first, then the Property's reviews, else none. */
export function googleReviewLink(
  detail:
    | Pick<InboxItemDetailResult, 'googleReviewUrl' | 'googlePropertyReviewsUrl'>
    | null
    | undefined,
): GoogleReviewLink | null {
  const review = detail?.googleReviewUrl ?? null
  if (review !== null && isGoogleHref(review, 'review')) {
    return { kind: 'review', href: review }
  }
  const property = detail?.googlePropertyReviewsUrl ?? null
  if (property !== null && isGoogleHref(property, 'property')) {
    return { kind: 'property', href: property }
  }
  return null
}

export type SentenceAroundGoogle = Readonly<{
  before: string
  phrase: string
  after: string
}>

/** The words, in any case: "Look at…" opens a sentence. No regex syntax in them. */
const LOOK_AT_THE_REVIEW_ON_GOOGLE_PATTERN = new RegExp(
  LOOK_AT_THE_REVIEW_ON_GOOGLE,
  'iu',
)

/**
 * A sentence cut around `LOOK_AT_THE_REVIEW_ON_GOOGLE`, or null when it has no
 * such words. Matched on the sentence itself, so the cut falls where the words
 * are in it whatever else the sentence holds (a time in the reader's locale).
 */
export function sentenceAroundGoogle(text: string): SentenceAroundGoogle | null {
  const match = LOOK_AT_THE_REVIEW_ON_GOOGLE_PATTERN.exec(text)
  if (match === null) return null
  const end = match.index + match[0].length
  return {
    before: text.slice(0, match.index),
    phrase: match[0],
    after: text.slice(end),
  }
}
