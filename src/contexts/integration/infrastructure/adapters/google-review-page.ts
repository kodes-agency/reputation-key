// Google's per-review Business Profile page (`reviewReplyUrl`, output-only,
// "URL for replying to the review", GBP API v4.9), as the review adapter reads
// it for "Open on Google" in the Inbox (2026-10-17).
//
// It must never fail a page. The field is caught rather than validated by the
// page schema: anything but a string of at most 2,048 characters becomes ''
// (not a URL), and every value the validator refuses — that one included — is
// read as no page, counted and never logged.

import { z } from 'zod/v4'
import type { LoggerPort } from '#/shared/domain/logger.port'
import {
  MAX_GOOGLE_REVIEW_REPLY_URL_LENGTH,
  normalizeGoogleReviewReplyUrl,
} from '#/shared/domain/google-review-links'

/** The review item schema's `reviewReplyUrl` field. */
export const reviewReplyUrlField = z
  .string()
  .max(MAX_GOOGLE_REVIEW_REPLY_URL_LENGTH)
  .optional()
  .catch('')

type ProviderReviewPage = Readonly<{ reviewReplyUrl?: string }>

/**
 * The review's own page, kept only in the shape Google sends for the location
 * in the review's own resource name; null for anything else, or none.
 */
export function reviewPageUrl(
  raw: ProviderReviewPage,
  locationId: string,
): string | null {
  return raw.reviewReplyUrl === undefined
    ? null
    : normalizeGoogleReviewReplyUrl(raw.reviewReplyUrl, locationId)
}

/**
 * Content-free, like the adapter's cursor diagnostics: how many, never which
 * review or what Google sent. A refused page only means the Inbox offers the
 * Property's reviews instead; the reviews themselves are kept.
 */
export function reportRefusedReviewPages(
  logger: LoggerPort,
  operation: 'reviews.list' | 'reviews.get',
  raws: ReadonlyArray<ProviderReviewPage>,
  pages: ReadonlyArray<string | null>,
): void {
  const refused = raws.filter(
    (raw, index) => raw.reviewReplyUrl !== undefined && pages[index] === null,
  ).length
  if (refused === 0) return
  logger.warn(
    { event: 'reviews_reply_url_refused', operation, refused },
    'Google review page links refused',
  )
}
