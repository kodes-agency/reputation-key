// Review context — what a persisting head check stores from Google's newest page.
//
// `REVIEW_HEAD_CHECKS=persist` (ADR 0055, note of 2026-10-21 (d)). After a head
// check read and compared a page, this stores:
//
//  - the reviews the comparison classes `new`, `changed`, `reply_changed` or
//    `lease_refresh`, through the ordinary observation writer (origin `ongoing`,
//    with the writer's own epoch-cutoff reclassification; a new review is
//    recorded in the push health ledger as first seen via `head`). A review that
//    matches its stored copy is NOT written again: the writer would add a source
//    observation carrying its full text every time.
//  - Google's own count and average as a head fact (`listing_complete = false`),
//    when they moved or the newest fact is six hours old (`decideHeadFact`).
//
// It stores nothing while the epoch has no completed listing (the gate), nor
// while a snapshot run of the Property is active (a head write between a run's
// page and its reply record would stale the run's material revision), nor when
// the Property's source epoch moved after the read.
//
// It never throws. A failed write is counted, logged without an identifier and
// retried by the next look; it sets no repair latch.

import type { GoogleConnectionId, OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { sha256Hex } from '#/shared/domain/sha256'
import { parseReviewProviderResource } from '#/shared/review-provider-subject-contract'
import { headReviewsToPersist, type HeadStoredCopy } from '../../domain/head-check'
import { decideHeadFact } from '../../domain/head-persist'
import type { GoogleReviewRead } from '../ports/google-review-api.port'
import type { PropertySourceEpochPort } from '../ports/property-source-epoch.port'
import type {
  ReviewHeadCheckRepository,
  ReviewHeadPersistence,
} from '../ports/review-head-check.repository'
import type { ReviewProviderObservationWriter } from '../ports/review-provider-observation-writer.port'
import type { ReviewSyncActivityRecorder } from '../ports/review-sync-activity.port'
import type { ReviewProviderSubjectKeyService } from '../provider-subject-keyring'

export type PersistReviewHeadPageDeps = Readonly<{
  observationWriter: ReviewProviderObservationWriter
  subjectKeyService: ReviewProviderSubjectKeyService
  propertySourceEpoch: PropertySourceEpochPort
  /** Stamps the discovery ladder when a head check finds a review nobody held. */
  syncActivity: Pick<ReviewSyncActivityRecorder, 'recordNewReviewObserved'>
  /** A fresh identifier for a head fact: it has no snapshot run to borrow one from. */
  newId: () => string
  repository: Pick<ReviewHeadCheckRepository, 'readPersistState' | 'recordHeadFact'>
  logger: Pick<LoggerPort, 'warn'>
  clock: () => Date
}>

export type PersistReviewHeadPageInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  connectionId: GoogleConnectionId
  sourceEpoch: number
  locationName: string
  /** The page, exactly as the provider adapter mapped it. */
  reviews: readonly GoogleReviewRead[]
  copies: readonly HeadStoredCopy[]
  googleTotal: number
  googleAverage: number | null
  /** Allocated right after the provider's response, once for the whole page. */
  replyReadGeneration: number
  /** When the page was read: the time Google's numbers are stamped with. */
  readAt: Date
  /** The instant the comparison classified the page at, so both agree on lease refreshes. */
  now: Date
}>

const NOTHING_STORED: Omit<ReviewHeadPersistence, 'outcome'> = {
  storedNew: 0,
  storedOther: 0,
  failed: 0,
  factWritten: false,
}

/**
 * One key per review per check. The read generation is allocated per page, so a
 * key never repeats: an observation key that did repeat would be a replay, and
 * a replay returns the stored result WITHOUT applying new content, which would
 * swallow an A to B to A edit. 64 hex characters, as the observation store
 * requires.
 */
const headObservationKey = (readGeneration: number, reviewName: string): string =>
  sha256Hex(`repkey-review-head-observation-v1\0${readGeneration}\0${reviewName}`)

type Counts = { storedNew: number; storedOther: number; failed: number }

const storeReviews = async (
  deps: PersistReviewHeadPageDeps,
  input: PersistReviewHeadPageInput,
): Promise<Counts> => {
  const toStore = headReviewsToPersist({
    now: input.now,
    sourceEpoch: input.sourceEpoch,
    hasMore: false,
    reviews: input.reviews,
    copies: input.copies,
    googleTotal: input.googleTotal,
    googleAverage: input.googleAverage,
    storedLiveCount: 0,
    storedAverage: null,
  })
  const counts: Counts = { storedNew: 0, storedOther: 0, failed: 0 }
  if (toStore.length === 0) return counts
  const deriver = await deps.subjectKeyService.acquireDeriver()
  for (const review of toStore) {
    try {
      const resource = parseReviewProviderResource(review.reviewName)
      if (
        `accounts/${resource.accountId}/locations/${resource.locationId}` !==
        input.locationName
      ) {
        counts.failed++
        continue
      }
      const persisted = await deps.observationWriter.persist({
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        connectionId: input.connectionId,
        sourceEpoch: input.sourceEpoch,
        observationOrigin: 'ongoing',
        firstSeenVia: 'head',
        observationKey: headObservationKey(input.replyReadGeneration, review.reviewName),
        replyReadGeneration: input.replyReadGeneration,
        review,
        subjects: deriver.deriveCandidates({
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          sourceEpoch: input.sourceEpoch,
          resourceName: review.reviewName,
        }),
      })
      if (persisted.isNew) counts.storedNew++
      else counts.storedOther++
    } catch {
      counts.failed++
    }
  }
  return counts
}

const stampNewReviews = async (
  deps: PersistReviewHeadPageDeps,
  input: PersistReviewHeadPageInput,
): Promise<void> => {
  try {
    await deps.syncActivity.recordNewReviewObserved(input.propertyId, deps.clock())
  } catch {
    deps.logger.warn(
      { event: 'review_head_check_activity_not_recorded' },
      'Review head check could not stamp discovery activity',
    )
  }
}

const storeFact = async (
  deps: PersistReviewHeadPageDeps,
  input: PersistReviewHeadPageInput,
  newestFact: Awaited<
    ReturnType<ReviewHeadCheckRepository['readPersistState']>
  >['newestFact'],
): Promise<boolean> => {
  const decision = decideHeadFact({
    readAt: input.readAt,
    googleTotal: input.googleTotal,
    googleAverage: input.googleAverage,
    hasCompletedListing: true,
    newest: newestFact,
  })
  if (!decision.write) return false
  try {
    await deps.repository.recordHeadFact({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      sourceEpoch: input.sourceEpoch,
      factId: deps.newId(),
      reviewCount: input.googleTotal,
      averageRating: input.googleAverage,
      numbersObservedAt: decision.numbersObservedAt,
    })
    return true
  } catch {
    deps.logger.warn(
      { event: 'review_head_check_fact_not_recorded' },
      'Review head check could not record the head fact',
    )
    return false
  }
}

/**
 * Storing the reviews took time (up to a page of writes) and the first read took
 * no lock, so a snapshot run may have started and another head check may have
 * written a fact since. Read the state again and decide on that: no fact while a
 * run is active, and the decision sees the newest fact as it is now. A failed
 * re-read falls back to the first state, which only costs a duplicate fact.
 */
const storeFactIfStillClear = async (
  deps: PersistReviewHeadPageDeps,
  input: PersistReviewHeadPageInput,
  firstNewestFact: Awaited<
    ReturnType<ReviewHeadCheckRepository['readPersistState']>
  >['newestFact'],
): Promise<boolean> => {
  try {
    const fresh = await deps.repository.readPersistState({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      sourceEpoch: input.sourceEpoch,
      now: deps.clock(),
    })
    if (fresh.snapshotActive) return false
    return storeFact(deps, input, fresh.newestFact)
  } catch {
    return storeFact(deps, input, firstNewestFact)
  }
}

/** Store what a compared page differs by. Never throws. */
export const persistReviewHeadPage = async (
  deps: PersistReviewHeadPageDeps,
  input: PersistReviewHeadPageInput,
): Promise<ReviewHeadPersistence> => {
  try {
    const state = await deps.repository.readPersistState({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      sourceEpoch: input.sourceEpoch,
      now: deps.clock(),
    })
    if (!state.hasCompletedListing) {
      return { outcome: 'skipped_no_listing', ...NOTHING_STORED }
    }
    if (state.snapshotActive) {
      return { outcome: 'skipped_snapshot_active', ...NOTHING_STORED }
    }
    const current = await deps.propertySourceEpoch.getSourceEpoch(
      input.organizationId,
      input.propertyId,
    )
    if (current === null || current.sourceEpoch !== input.sourceEpoch) {
      return { outcome: 'skipped_epoch_moved', ...NOTHING_STORED }
    }
    const counts = await storeReviews(deps, input)
    if (counts.storedNew > 0) await stampNewReviews(deps, input)
    if (counts.failed > 0) {
      deps.logger.warn(
        { event: 'review_head_check_persist_failed', failed: counts.failed },
        'Review head check could not store some reviews',
      )
    }
    const factWritten = await storeFactIfStillClear(deps, input, state.newestFact)
    return { outcome: 'stored', ...counts, factWritten }
  } catch {
    deps.logger.warn(
      { event: 'review_head_check_persist_unavailable' },
      'Review head check could not store its page',
    )
    return { outcome: 'unavailable', ...NOTHING_STORED }
  }
}
