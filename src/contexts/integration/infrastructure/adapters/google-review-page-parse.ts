// What Google's reviews.list and reviews.get answer with, as the review adapter
// reads it: the strict-enough page and review schemas, the mapping to the
// Review context's `GoogleReviewRead`, and the order check the head read needs.
// Pure and provider-token-free; the adapter owns the calls, this owns the shape.

import { z } from 'zod/v4'
import type { StarRating } from '#/contexts/review/application/public-api'
import type { GoogleReviewRead } from '#/contexts/review/application/ports/google-review-api.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import {
  parseReviewProviderResource,
  type ReviewProviderResource,
} from '#/shared/review-provider-subject-contract'
import {
  parseGoogleReplyComment,
  parseGoogleReviewComment,
} from '#/shared/google-review-comment'
import {
  reportRefusedReviewPages,
  reviewPageUrl,
  reviewReplyUrlField,
} from './google-review-page'
import { reviewApiError } from './google-review-api-errors'
import {
  parseReplyModeration,
  replyModerationFields,
  reportReplyModeration,
} from './google-review-reply-moderation'

const PAGE_SIZE = 50

const STAR_RATING_MAP: Readonly<Record<string, StarRating | undefined>> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
}

// Provider payloads are not our transport: Google adds response fields without
// notice, and rejecting an otherwise valid page for carrying one is a sync
// outage, not a safety property. A real closed-beta page arrived with
// `reviewId`, `updateTime` and `reviewReplyUrl` per review plus a top-level
// `averageRating`; `.strict()` turned all of it into `malformed_response` →
// `malformed_page`, and the property synced zero reviews. Unknown keys are
// dropped (zod's default strip) so nothing unmodelled reaches the domain, while
// every field we do read stays fully validated. The sibling Google adapters
// (gbp-api, google-business-information) already tolerate unknown keys.
//
// `reviewReplyUrl` is read since 2026-10-17 ("Open on Google" in the Inbox) and
// never fails a page (`google-review-page.ts`).
export const gbpReviewItemSchema = z.object({
  name: z.string().min(1).max(1_024),
  starRating: z.string(),
  comment: z.string().optional(),
  reviewer: z
    .object({
      displayName: z.string().optional(),
      profilePhotoUrl: z.string().optional(),
    })
    .optional(),
  reviewReply: z
    .object({
      comment: z.string().optional(),
      updateTime: z.string().optional(),
      // Google's moderation of the reply, read and counted only
      // (`google-review-reply-moderation.ts`); it never fails a page.
      ...replyModerationFields,
    })
    .optional(),
  createTime: z.string().min(1).max(64),
  updateTime: z.string().min(1).max(64).optional(),
  reviewReplyUrl: reviewReplyUrlField,
})

const gbpReviewsPageSchema = z
  .object({
    reviews: z.array(gbpReviewItemSchema).max(PAGE_SIZE).optional(),
    // Google OMITS this field for a location with no reviews — the response
    // body is `{}`, not `{totalReviewCount: 0}`. Requiring it turned "this
    // location has no reviews" into `malformed_page`, which fails the whole
    // snapshot run rather than recording an empty result. Observed live on
    // 2026-09-02 for every property in the closed beta:
    //   Google reviews page rejected by schema keys=[]
    //     issues=["totalReviewCount:invalid_type"]
    // and `sync-property-reviews` never completed a single run in this
    // deployment's history as a result.
    //
    // Absent therefore means zero, which is the reading the rest of this
    // schema already assumes: the refinement below has always handled
    // `totalReviewCount === 0`, so a zero page was expected as a value and
    // simply never arrived as one.
    totalReviewCount: z.number().int().safe().nonnegative().default(0),
    averageRating: z.number().finite().min(0).max(5).optional(),
    nextPageToken: z.string().min(1).max(2_048).optional(),
  })
  .superRefine((page, context) => {
    if (page.totalReviewCount === 0) {
      if (page.averageRating !== undefined && page.averageRating !== 0) {
        context.addIssue({
          code: 'custom',
          path: ['averageRating'],
          message: 'A zero-review page cannot carry a non-zero average',
        })
      }
      return
    }
    if (page.averageRating === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['averageRating'],
        message: 'A non-empty review snapshot requires the provider average',
      })
    }
  })

export type GbpReviewItem = z.infer<typeof gbpReviewItemSchema>

function parseDate(value: string): Date {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime()))
    throw reviewApiError('malformed_response', false)
  return parsed
}

export function mapReview(
  raw: GbpReviewItem,
  locationName: string,
): GoogleReviewRead & Readonly<{ replyUnreadable: boolean }> {
  let resource: ReviewProviderResource
  try {
    resource = parseReviewProviderResource(raw.name)
  } catch {
    throw reviewApiError('malformed_response', false)
  }
  if (
    `accounts/${resource.accountId}/locations/${resource.locationId}` !== locationName
  ) {
    throw reviewApiError('malformed_response', false)
  }
  const rating = STAR_RATING_MAP[raw.starRating]
  if (!rating) throw reviewApiError('malformed_response', false)
  // Google ships the machine translation and the guest's own words glued into
  // one `comment` field. `text` must be the original: language detection and the
  // whole AI reply plane read it, and the blob made 8 Bulgarian reviews look
  // like reliable English.
  const comment = parseGoogleReviewComment(raw.comment)
  const reply = parseGoogleReplyComment(raw.reviewReply?.comment)
  return {
    reviewName: raw.name,
    externalId: resource.reviewId,
    externalLocationId: locationName,
    reviewerName: raw.reviewer?.displayName ?? null,
    reviewerProfilePhotoUrl: raw.reviewer?.profilePhotoUrl ?? null,
    googleReviewUrl: reviewPageUrl(raw, resource.locationId),
    rating,
    text: comment.original,
    translatedText: comment.translation,
    languageCode: null,
    reviewedAt: parseDate(raw.createTime),
    sourceCreatedAt: parseDate(raw.createTime),
    sourceUpdatedAt: raw.updateTime ? parseDate(raw.updateTime) : null,
    // Google wraps an echoed reply in the same translation envelope it wraps
    // review text in - `(Translated by Google) <en>\n\n(Original)\n<src>` -
    // whenever the reply language differs from the reader locale. The review
    // text two lines above is already split; the reply was not, so the digest
    // of the whole blob never matched the digest of what we sent. Measured on
    // the beta property: a Bulgarian reply that Google had published at
    // 09:01:28Z could not be confirmed, so it settled as "Google status
    // unconfirmed" and no reply on a translated review could ever reach
    // Published.
    replyText: reply.text,
    // A reply Google shows without a recoverable original (translation-only
    // envelope) is not "no reply": reconciliation must not read it as absent.
    replyUnreadable: reply.unreadable,
    replyUpdatedAt: raw.reviewReply?.updateTime
      ? parseDate(raw.reviewReply.updateTime)
      : null,
    replyModeration: parseReplyModeration(raw).moderation,
  }
}

export type ParsedReviewsPage = Readonly<{
  reviews: ReadonlyArray<ReturnType<typeof mapReview>>
  totalReviewCount: number
  /** Null only when the provider reports zero reviews. */
  averageRating: number | null
  nextPageToken: string | undefined
}>

/**
 * One reviews.list response body, validated and mapped. A page Google considers
 * well-formed that this schema refuses is logged by shape only (key names and
 * zod issue codes, never values) and ends as `malformed_response`.
 */
export function parseReviewsPage(
  raw: unknown,
  locationName: string,
  logger: LoggerPort,
): ParsedReviewsPage {
  const parsed = gbpReviewsPageSchema.safeParse(raw)
  if (!parsed.success) {
    // Shape only — key names and zod issue paths/codes, never values. A page
    // the provider considers well-formed must never be indistinguishable
    // from a transport fault in the logs.
    logger.warn(
      {
        event: 'reviews_page_rejected',
        keys:
          typeof raw === 'object' && raw !== null ? Object.keys(raw).sort() : typeof raw,
        issues: parsed.error.issues
          .slice(0, 12)
          .map((issue) =>
            issue.code === 'unrecognized_keys'
              ? `${issue.path.join('.') || '<root>'}:unrecognized:${issue.keys.join('|')}`
              : `${issue.path.join('.') || '<root>'}:${issue.code}`,
          ),
      },
      'Google reviews page rejected by schema',
    )
    throw reviewApiError('malformed_response', false)
  }
  const rawReviews = parsed.data.reviews ?? []
  const reviews = rawReviews.map((review) => mapReview(review, locationName))
  reportRefusedReviewPages(
    logger,
    'reviews.list',
    rawReviews,
    reviews.map((review) => review.googleReviewUrl),
  )
  reportReplyModeration(logger, 'reviews.list', rawReviews)
  return {
    reviews,
    totalReviewCount: parsed.data.totalReviewCount,
    averageRating: parsed.data.totalReviewCount === 0 ? null : parsed.data.averageRating!,
    nextPageToken: parsed.data.nextPageToken,
  }
}

/**
 * Whether a page really is newest-updated first: every review carries an
 * updateTime and none is newer than the one before it (ties are fine). The head
 * read asks Google for that order and trusts nothing it cannot check, so a page
 * that fails this is never compared with. An empty page is in order.
 */
export function isNewestUpdatedFirst(
  reviews: ReadonlyArray<Pick<GoogleReviewRead, 'sourceUpdatedAt'>>,
): boolean {
  let previous: number | null = null
  for (const review of reviews) {
    if (review.sourceUpdatedAt == null) return false
    const current = review.sourceUpdatedAt.getTime()
    if (previous !== null && current > previous) return false
    previous = current
  }
  return true
}
