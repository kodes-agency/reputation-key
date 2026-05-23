// Review context — sync reviews use case
// Fetches reviews from Google for a single location, upserts them, mirrors reply state.
//
// Architecture note: This use case intentionally bypasses the `buildReview` and `buildReply`
// domain constructors. Review data comes from the Google API adapter layer, which has already
// validated and mapped the external payload. The adapter returns typed `GoogleReview` objects
// with validated ratings (1-5) and non-empty text. Routing through constructors would add
// redundant validation on trusted external data. If the adapter's guarantees change, this
// decision should be revisited.
//
// This is a system-level job (triggered by webhook or scheduled job), so it skips the
// "authorize" step of the 7-step use case pattern. AuthN is handled upstream by the
// Pub/Sub JWT verifier (webhook) or the BullMQ job dispatcher (scheduled).

import type { ReviewRepository } from '../ports/review.repository'
import type { ReplyRepository } from '../ports/reply.repository'
import type { GoogleReviewApiPort } from '../ports/google-review-api.port'
import type { EventBus } from '#/shared/events/event-bus'
import type {
  ReviewId,
  ReplyId,
  OrganizationId,
  PropertyId,
  GoogleConnectionId,
} from '#/shared/domain/ids'
import type { Review, GoogleReview } from '../../domain/types'
import type { ReviewError } from '../../domain/errors'
import type { Logger } from 'pino'
import { reviewCreated, reviewUpdated } from '../../domain/events'
import { reviewError } from '../../domain/errors'
import { calculateExpiresAt } from '../../domain/rules'
import { ok, err, type Result } from 'neverthrow'

export type SyncReviewsDeps = Readonly<{
  reviewRepo: ReviewRepository
  replyRepo: ReplyRepository
  googleReviewApi: GoogleReviewApiPort
  events: EventBus
  clock: () => Date
  idGen: () => ReviewId
  replyIdGen: () => ReplyId
  logger: Logger
}>

export type SyncReviewsInput = Readonly<{
  propertyId: PropertyId
  organizationId: OrganizationId
  connectionId: GoogleConnectionId
  locationName: string
}>

export type SyncReviewsResult = Readonly<{
  fetched: number
  created: number
  updated: number
  repliesMirrored: number
  failed: number
  /** True when some reviews failed to sync but others succeeded. */
  partialFailure: boolean
}>

export const syncReviews =
  (deps: SyncReviewsDeps) =>
  async (input: SyncReviewsInput): Promise<Result<SyncReviewsResult, ReviewError>> => {
    const now = deps.clock()

    // 1. Fetch all reviews from Google (pagination handled inside facade port)
    let googleReviews: ReadonlyArray<GoogleReview>
    try {
      googleReviews = await deps.googleReviewApi.fetchReviews(
        input.organizationId,
        input.connectionId,
        input.locationName,
      )
    } catch (e: unknown) {
      const cause =
        e instanceof Error
          ? e.message
          : typeof e === 'object' && e !== null && 'message' in e
            ? (e as { message: string }).message
            : String(e)
      return err(
        reviewError('sync_failed', 'Failed to fetch reviews from Google', { cause }),
      )
    }

    let created = 0
    let updated = 0
    let repliesMirrored = 0
    let failed = 0

    for (const gr of googleReviews) {
      try {
        // 2. Check if review already exists
        const existing = await deps.reviewRepo.findByExternalId(
          'google',
          gr.externalId,
          input.organizationId,
        )

        // Calculate expiresAt from reviewedAt per 30-day retention rule
        const expiresAt = calculateExpiresAt(gr.reviewedAt, now)

        // 3. Build review domain object
        const review: Omit<Review, 'createdAt' | 'updatedAt'> = {
          id: existing?.id ?? deps.idGen(),
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          platform: 'google',
          externalId: gr.externalId,
          externalLocationId: gr.externalLocationId,
          googleConnectionId: input.connectionId,
          reviewerName: gr.reviewerName,
          reviewerProfilePhotoUrl: gr.reviewerProfilePhotoUrl,
          rating: gr.rating,
          text: gr.text,
          languageCode: gr.languageCode,
          reviewedAt: gr.reviewedAt,
          expiresAt,
          sentimentLabel: existing?.sentimentLabel ?? null,
          sentimentScore: existing?.sentimentScore ?? null,
        }

        // 4. Upsert review
        await deps.reviewRepo.upsert(review, now)

        const isNew = !existing
        if (isNew) created++
        else updated++

        // 5. Mirror reply state from Google
        const mirrored = await mirrorReply(deps, review.id, input.organizationId, gr, now)
        if (mirrored) repliesMirrored++

        // 6. Emit domain event
        const eventPayload = {
          reviewId: review.id,
          propertyId: input.propertyId,
          organizationId: input.organizationId,
          platform: 'google' as const,
          externalId: gr.externalId,
          rating: gr.rating,
          reviewText: gr.text,
          staffId: null,
          occurredAt: now,
        }

        if (isNew) {
          await deps.events.emit(reviewCreated(eventPayload))
        } else {
          await deps.events.emit(reviewUpdated(eventPayload))
        }
      } catch (syncErr) {
        deps.logger.warn(
          { err: syncErr, externalId: gr.externalId },
          'Failed to sync review, continuing',
        )
        failed++
        continue
      }
    }

    const result: SyncReviewsResult = {
      fetched: googleReviews.length,
      created,
      updated,
      repliesMirrored,
      failed,
      partialFailure: failed > 0,
    }

    // Always return ok — data was persisted for all successful reviews.
    // Callers should check result.partialFailure to detect partial failures.
    return ok(result)
  }

async function mirrorReply(
  deps: SyncReviewsDeps,
  reviewId: ReviewId,
  organizationId: OrganizationId,
  gr: GoogleReview,
  now: Date,
): Promise<boolean> {
  const existingGoogleReply = await deps.replyRepo.findGoogleSyncByReviewId(
    reviewId,
    organizationId,
  )

  if (gr.replyText) {
    // Google has a reply → upsert google_sync reply
    if (existingGoogleReply) {
      // Update existing google_sync reply text
      await deps.replyRepo.upsert(
        {
          id: existingGoogleReply.id,
          reviewId,
          organizationId,
          text: gr.replyText,
          status: existingGoogleReply.status,
          source: 'google_sync',
          createdBy: existingGoogleReply.createdBy,
          approvedBy: existingGoogleReply.approvedBy,
          rejectedBy: existingGoogleReply.rejectedBy,
          rejectionReason: existingGoogleReply.rejectionReason,
          aiGenerated: existingGoogleReply.aiGenerated,
          publishedAt: gr.replyUpdatedAt ?? existingGoogleReply.publishedAt,
        },
        now,
      )
    } else {
      // Create new google_sync reply
      await deps.replyRepo.upsert(
        {
          id: deps.replyIdGen(),
          reviewId,
          organizationId,
          text: gr.replyText,
          status: 'published',
          source: 'google_sync',
          createdBy: null,
          approvedBy: null,
          rejectedBy: null,
          rejectionReason: null,
          aiGenerated: false,
          publishedAt: gr.replyUpdatedAt ?? now,
        },
        now,
      )
    }
    return true
  } else {
    // Google has no reply → delete google_sync reply if it exists
    if (existingGoogleReply) {
      await deps.replyRepo.deleteByReviewIdAndSource(
        reviewId,
        'google_sync',
        organizationId,
      )
      return true
    }
    return false
  }
}

export type SyncReviews = ReturnType<typeof syncReviews>
