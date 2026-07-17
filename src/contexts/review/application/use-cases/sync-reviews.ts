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
import {
  defaultReviewLifecycle,
  type Review,
  type GoogleReview,
} from '../../domain/types'
import type { ReviewError } from '../../domain/errors'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { reviewCreated, reviewUpdated, reviewReplyPublished } from '../../domain/events'
import { reviewError } from '../../domain/errors'
import {
  calculateExpiresAt,
  computeReviewContentHash,
  MAX_REPLY_LENGTH,
} from '../../domain/rules'
import { ok, err, type Result } from '#/shared/domain'
import { emitAndRecord } from '#/shared/outbox'
import type { ReviewCommandStore } from '../ports/review-command-store.port'

export type SyncReviewsDeps = Readonly<{
  reviewRepo: ReviewRepository
  replyRepo: ReplyRepository
  googleReviewApi: GoogleReviewApiPort
  events: EventBus
  clock: () => Date
  idGen: () => ReviewId
  replyIdGen: () => ReplyId
  logger: LoggerPort
  /**
   * BQR-2.3: Atomic review upsert + outbox insert (+ post-commit bus emit).
   * Required for review.created / review.updated durable recording.
   */
  commandStore: ReviewCommandStore
  /** Outbox for non-atomic emitAndRecord paths (e.g. reply mirrored events). */
  outboxRepo?: import('#/shared/outbox').OutboxRepository
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
  /**
   * Content-changed updates only (emitted `review.updated`).
   * Hash-stable re-fetches extend lifecycle clocks without counting here (BQR-3.4).
   */
  updated: number
  /**
   * BQC-1.3: content-free refresh fact — hash-stable successful refetches
   * that advanced the fetch clock (no semantic change, no event).
   */
  refreshed: number
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
      return err(
        reviewError('sync_failed', 'Failed to fetch reviews from Google', {
          cause: toErrorMessage(e),
        }),
      )
    }

    let created = 0
    let updated = 0
    let refreshed = 0
    let repliesMirrored = 0
    let failed = 0

    for (const gr of googleReviews) {
      try {
        const outcome = await syncOneReview(deps, gr, input, now)
        created += outcome.created
        updated += outcome.updated
        refreshed += outcome.refreshed
        repliesMirrored += outcome.repliesMirrored
        if (outcome.hadError) failed++
      } catch (syncErr) {
        deps.logger.warn(
          { err: syncErr, externalId: gr.externalId },
          'Failed to sync review, continuing',
        )
        failed++
      }
    }

    // Always return ok — data was persisted for all successful reviews.
    // Callers should check result.partialFailure to detect partial failures.
    return ok({
      fetched: googleReviews.length,
      created,
      updated,
      refreshed,
      repliesMirrored,
      failed,
      partialFailure: failed > 0,
    })
  }

/** Best-effort stringification of an unknown caught value, for error `cause`. */
function toErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'object' && e !== null && 'message' in e)
    return (e as { message: string }).message
  return String(e)
}

/** Sync a single Google review: upsert + mirror reply + emit event. Returns the delta counts. */
async function syncOneReview(
  deps: SyncReviewsDeps,
  gr: GoogleReview,
  input: SyncReviewsInput,
  now: Date,
): Promise<{
  created: number
  updated: number
  refreshed: number
  repliesMirrored: number
  hadError: boolean
}> {
  const existing = await deps.reviewRepo.findByExternalId(
    'google',
    gr.externalId,
    input.organizationId,
  )

  const contentHash = computeReviewContentHash({
    rating: gr.rating,
    text: gr.text,
    reviewerName: gr.reviewerName,
    languageCode: gr.languageCode,
  })

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
    expiresAt: calculateExpiresAt(gr.reviewedAt, now),
    sentimentLabel: existing?.sentimentLabel ?? null,
    sentimentScore: existing?.sentimentScore ?? null,
    // BQR-3.1: fetch-based content expiry + content hash on every successful sync
    ...defaultReviewLifecycle({
      reviewedAt: gr.reviewedAt,
      now,
      contentHash,
      existing: existing ?? null,
    }),
  }

  const isNew = !existing
  // BQR-3.4 / ADR 0031: same hash → lifecycle-only refresh, no review.updated.
  // Null existing hash (pre-3.1 row) is treated as content-changed once to establish baseline.
  const contentUnchanged =
    !isNew && existing.contentHash != null && existing.contentHash === contentHash

  let repliesMirrored = 0
  let hadError = false
  let persisted = false
  let contentChanged = false
  try {
    if (contentUnchanged) {
      // Extend lastFetchedAt / contentExpiresAt only — no domain event / outbox row.
      await deps.reviewRepo.upsert(review, now)
      persisted = true
    } else {
      // BQR-2.3: review row + outbox event in one transaction (via command store).
      // BQC-1.2: identifier-only domain event — no rating (raw content);
      // consumers resolve content via the authorized read at consume time.
      const eventPayload = {
        reviewId: review.id,
        propertyId: input.propertyId,
        organizationId: input.organizationId,
        platform: 'google' as const,
        externalId: gr.externalId,
        occurredAt: gr.reviewedAt,
      }
      const event = isNew ? reviewCreated(eventPayload) : reviewUpdated(eventPayload)
      await deps.commandStore.upsertAndRecord(review, event, now)
      persisted = true
      contentChanged = !isNew
    }

    if (
      await mirrorReply(deps, review.id, input.organizationId, input.propertyId, gr, now)
    )
      repliesMirrored = 1
  } catch (syncErr) {
    // Atomic upsert+outbox rolled back together if the TX fails. After commit,
    // mirrorReply failures still count as partial (review+outbox already durable).
    deps.logger.warn(
      { err: syncErr, externalId: gr.externalId },
      'Failed to sync review, continuing',
    )
    hadError = true
  }

  return {
    created: isNew && persisted ? 1 : 0,
    // `updated` means content-changed emission, not mere lifecycle refresh.
    updated: contentChanged && persisted ? 1 : 0,
    // BQC-1.3: content-free refresh fact — clock advanced, no event emitted.
    refreshed: contentUnchanged && persisted ? 1 : 0,
    repliesMirrored,
    hadError,
  }
}

async function mirrorReply(
  deps: SyncReviewsDeps,
  reviewId: ReviewId,
  organizationId: OrganizationId,
  propertyId: PropertyId,
  gr: GoogleReview,
  now: Date,
): Promise<boolean> {
  // F145 NOTE: mirrorReply creates/updates google_sync replies from Google's
  // authoritative data. If a locally-drafted reply was published between sync
  // runs, the published reply's text takes precedence — this is intentional.
  // The upsert below preserves local metadata (createdBy, approvedBy, etc.)
  // while updating text and publishedAt from Google's response.
  const existingGoogleReply = await deps.replyRepo.findGoogleSyncByReviewId(
    reviewId,
    organizationId,
  )

  if (gr.replyText) {
    // Clamp mirrored Google reply text to MAX_REPLY_LENGTH at the adapter boundary.
    // google_sync replies bypass buildReply (ADR 0003 decision 6); enforce the same
    // length invariant here so a Google reply longer than 4096 chars is truncated, not
    // persisted unvalidated.
    const mirroredText = gr.replyText.slice(0, MAX_REPLY_LENGTH)
    // Google has a reply → upsert google_sync reply
    if (existingGoogleReply) {
      // Update existing google_sync reply text
      await deps.replyRepo.upsert(
        {
          id: existingGoogleReply.id,
          reviewId,
          organizationId,
          text: mirroredText,
          status: existingGoogleReply.status,
          source: 'google_sync',
          createdBy: existingGoogleReply.createdBy,
          approvedBy: existingGoogleReply.approvedBy,
          rejectedBy: existingGoogleReply.rejectedBy,
          rejectionReason: existingGoogleReply.rejectionReason,
          aiGenerated: existingGoogleReply.aiGenerated,
          publishedAt: gr.replyUpdatedAt ?? existingGoogleReply.publishedAt,
          submittedAt: existingGoogleReply.submittedAt,
          approvedAt: existingGoogleReply.approvedAt,
        },
        now,
      )
    } else {
      // Create new google_sync reply
      const replyId = deps.replyIdGen()
      await deps.replyRepo.upsert(
        {
          id: replyId,
          reviewId,
          organizationId,
          text: mirroredText,
          status: 'published',
          source: 'google_sync',
          createdBy: null,
          approvedBy: null,
          rejectedBy: null,
          rejectionReason: null,
          aiGenerated: false,
          submittedAt: null,
          approvedAt: null,
          publishedAt: gr.replyUpdatedAt ?? now,
        },
        now,
      )
      // R2-001: emit reviewReplyPublished for Google-mirrored replies so
      // downstream handlers (inbox auto-transition, activity audit) fire.
      const replyEvent = reviewReplyPublished({
        source: 'import',
        authorId: null,
        userId: null,
        replyId,
        reviewId,
        organizationId,
        propertyId,
        occurredAt: now,
      })
      await emitAndRecord(deps.events, deps.outboxRepo, replyEvent)
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
