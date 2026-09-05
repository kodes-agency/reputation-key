import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  googleReplyObservationHeads,
  googleReplyObservations,
  materialReviewRevisions,
  reviews,
} from '#/shared/db/schema/review.schema'
import { organizationId, reviewId } from '#/shared/domain/ids'
import type { Tx } from '#/shared/outbox/commit'
import type {
  ReviewCurrentReplyObservationPermit,
  ReviewReplyObservationAuthority,
  ReviewReplyObservationExpectation,
} from '../application/ports/reply-observation-authority.port'
import { lockReplyTruthScope } from './reply-truth-serialization'
import {
  REVIEW_EXACT_CURRENT_APPLY_CLIENTS,
  REVIEW_EXACT_CURRENT_MAX_CONCURRENT_APPLIES,
  runWithReviewExactCurrentApplyAdmission,
} from './exact-current-apply-admission'

const sameInstant = (left: Date, right: Date): boolean =>
  left.getTime() === right.getTime()

const REVIEW_SOURCE_CONTENT_STATES = new Set<
  ReviewCurrentReplyObservationPermit['reviewSourceContentState']
>(['active', 'source_expired', 'provider_deleted'])

const RESPONSE_TARGET_ELIGIBILITIES = new Set<
  ReviewCurrentReplyObservationPermit['responseTargetEligibility']
>(['measured', 'historical_onboarding', 'legacy_unknown'])

function selectCurrentObservationHead(
  tx: Tx,
  expectation: ReviewReplyObservationExpectation,
) {
  return tx
    .select({
      organizationId: googleReplyObservationHeads.organizationId,
      propertyId: googleReplyObservationHeads.propertyId,
      reviewId: googleReplyObservationHeads.reviewId,
      observationRevision: googleReplyObservationHeads.observationRevision,
      sourceEpoch: googleReplyObservationHeads.sourceEpoch,
      materialReviewRevision: googleReplyObservationHeads.materialReviewRevision,
      currentReviewSourceEpoch: reviews.sourceEpoch,
      currentReviewMaterialReviewRevision: reviews.sourceRevision,
      reviewSourceContentState: reviews.sourceContentState,
      headState: googleReplyObservationHeads.state,
      headProvenance: googleReplyObservationHeads.provenance,
      state: googleReplyObservations.state,
      change: googleReplyObservations.change,
      resolution: googleReplyObservations.resolution,
      provenance: googleReplyObservations.provenance,
      matchedReplyId: googleReplyObservations.matchedReplyId,
      matchedPublicationCycle: googleReplyObservations.matchedPublicationCycle,
      observedAt: googleReplyObservations.observedAt,
      responseTargetEligibility: materialReviewRevisions.responseTargetEligibility,
      responseTargetStartAt: materialReviewRevisions.responseTargetStartAt,
      materialNormalizationVersion: materialReviewRevisions.normalizationVersion,
      materialNormalizedDigest: materialReviewRevisions.normalizedDigest,
    })
    .from(googleReplyObservationHeads)
    .innerJoin(
      googleReplyObservations,
      eq(googleReplyObservations.id, googleReplyObservationHeads.observationId),
    )
    .innerJoin(
      reviews,
      and(
        eq(reviews.id, googleReplyObservationHeads.reviewId),
        eq(reviews.organizationId, googleReplyObservationHeads.organizationId),
        eq(reviews.propertyId, googleReplyObservationHeads.propertyId),
      ),
    )
    .innerJoin(
      materialReviewRevisions,
      and(
        eq(materialReviewRevisions.reviewId, reviews.id),
        eq(materialReviewRevisions.organizationId, reviews.organizationId),
        eq(materialReviewRevisions.propertyId, reviews.propertyId),
        eq(materialReviewRevisions.sourceEpoch, reviews.sourceEpoch),
        eq(materialReviewRevisions.revision, reviews.sourceRevision),
      ),
    )
    .where(
      and(
        eq(googleReplyObservationHeads.reviewId, expectation.reviewId),
        eq(googleReplyObservationHeads.organizationId, expectation.organizationId),
      ),
    )
    .for('update', { of: googleReplyObservationHeads })
    .limit(1)
}

type CurrentObservationHeadRow = Awaited<
  ReturnType<typeof selectCurrentObservationHead>
>[number]

/**
 * A revision gap is safe for Inbox to collapse only when Review can prove the
 * immediate predecessor held the same normalized material in an older source
 * epoch. A material edit changes the digest and therefore never gets a carry
 * permit.
 */
async function sourceEpochCarryFromMaterialReviewRevision(
  tx: Tx,
  current: CurrentObservationHeadRow,
): Promise<number | null> {
  const previousRevision = current.materialReviewRevision - 1
  if (
    !Number.isSafeInteger(previousRevision) ||
    previousRevision < 1 ||
    current.materialNormalizedDigest === null
  ) {
    return null
  }
  const [previous] = await tx
    .select({
      revision: materialReviewRevisions.revision,
      sourceEpoch: materialReviewRevisions.sourceEpoch,
      normalizationVersion: materialReviewRevisions.normalizationVersion,
      normalizedDigest: materialReviewRevisions.normalizedDigest,
    })
    .from(materialReviewRevisions)
    .where(
      and(
        eq(materialReviewRevisions.organizationId, current.organizationId),
        eq(materialReviewRevisions.propertyId, current.propertyId),
        eq(materialReviewRevisions.reviewId, current.reviewId),
        eq(materialReviewRevisions.revision, previousRevision),
      ),
    )
    .limit(1)
  if (
    previous === undefined ||
    previous.sourceEpoch >= current.sourceEpoch ||
    previous.normalizationVersion !== current.materialNormalizationVersion ||
    previous.normalizedDigest !== current.materialNormalizedDigest
  ) {
    return null
  }
  return previous.revision
}

/**
 * Exactness for one Google reply observation: the locked head must still be the
 * revision the consumer acted on, the Review source must not have moved under
 * it, the head must still denormalize that observation's own state/provenance,
 * every decision field must be unchanged, and the classification enums must be
 * well formed. Every clause is an independent equality against the same
 * expectation, so they are kept together as one readable decision.
 */
function isExactCurrentObservation(
  current: CurrentObservationHeadRow,
  expectation: ReviewReplyObservationExpectation,
): boolean {
  return (
    current.organizationId === expectation.organizationId &&
    current.propertyId === expectation.propertyId &&
    current.reviewId === expectation.reviewId &&
    current.observationRevision === expectation.observationRevision &&
    current.sourceEpoch === expectation.sourceEpoch &&
    current.materialReviewRevision === expectation.materialReviewRevision &&
    current.currentReviewSourceEpoch === expectation.sourceEpoch &&
    current.currentReviewMaterialReviewRevision === expectation.materialReviewRevision &&
    current.headState === current.state &&
    current.headProvenance === current.provenance &&
    current.change === expectation.change &&
    current.resolution === expectation.resolution &&
    current.provenance === expectation.provenance &&
    current.matchedReplyId === expectation.matchedReplyId &&
    current.matchedPublicationCycle === expectation.matchedPublicationCycle &&
    (current.state === 'live' || current.state === 'absent') &&
    REVIEW_SOURCE_CONTENT_STATES.has(
      current.reviewSourceContentState as ReviewCurrentReplyObservationPermit['reviewSourceContentState'],
    ) &&
    RESPONSE_TARGET_ELIGIBILITIES.has(
      current.responseTargetEligibility as ReviewCurrentReplyObservationPermit['responseTargetEligibility'],
    ) &&
    ((current.responseTargetEligibility === 'measured' &&
      current.responseTargetStartAt instanceof Date) ||
      (current.responseTargetEligibility !== 'measured' &&
        current.responseTargetStartAt === null)) &&
    sameInstant(current.observedAt, expectation.occurredAt)
  )
}

/** One exact-current apply holds the Review transaction while its Inbox
 * callback opens the consumer-owned transaction, so it can require two pool
 * clients at the same time. Keep process-wide admission below pool capacity;
 * queued callers hold no database client. */
export const REPLY_OBSERVATION_APPLY_CLIENTS = REVIEW_EXACT_CURRENT_APPLY_CLIENTS
export const REPLY_OBSERVATION_MAX_CONCURRENT_APPLIES =
  REVIEW_EXACT_CURRENT_MAX_CONCURRENT_APPLIES

/**
 * Review-owned exact-current authority.
 *
 * The advisory lock is the same Review-scoped fence used by observation
 * writes. It remains held while the callback commits the consumer's own
 * transaction. PostgreSQL cannot atomically commit two context-owned
 * transactions together, so this deliberate fence closes the only dangerous
 * interval: a newer Review head cannot land between validation and the Inbox
 * commit. If the outer read-only transaction later fails, Inbox's receipt
 * makes redelivery idempotent.
 */
export const createReviewReplyObservationAuthority = (
  db: Database,
): ReviewReplyObservationAuthority => ({
  withExactCurrent: async <T>(
    expectation: ReviewReplyObservationExpectation,
    apply: (permit: ReviewCurrentReplyObservationPermit) => Promise<T>,
  ) =>
    runWithReviewExactCurrentApplyAdmission(() =>
      db.transaction(async (tx) => {
        await lockReplyTruthScope(
          tx,
          organizationId(expectation.organizationId),
          reviewId(expectation.reviewId),
        )

        const rows = await selectCurrentObservationHead(tx, expectation)
        const current = rows[0]
        if (current === undefined || !isExactCurrentObservation(current, expectation)) {
          return { status: 'obsolete' as const }
        }

        const sourceEpochCarryFrom = await sourceEpochCarryFromMaterialReviewRevision(
          tx,
          current,
        )

        const permit: ReviewCurrentReplyObservationPermit = {
          authority: 'review.current-google-reply-observation.v1',
          organizationId: current.organizationId,
          propertyId: current.propertyId,
          reviewId: current.reviewId,
          observationRevision: current.observationRevision,
          sourceEpoch: current.sourceEpoch,
          materialReviewRevision: current.materialReviewRevision,
          sourceEpochCarryFromMaterialReviewRevision: sourceEpochCarryFrom,
          state: current.state === 'live' ? 'live' : 'absent',
          change: expectation.change,
          resolution: expectation.resolution,
          provenance: expectation.provenance,
          matchedReplyId: current.matchedReplyId,
          matchedPublicationCycle: current.matchedPublicationCycle,
          observedAt: current.observedAt,
          reviewSourceContentState:
            current.reviewSourceContentState as ReviewCurrentReplyObservationPermit['reviewSourceContentState'],
          responseTargetEligibility:
            current.responseTargetEligibility as ReviewCurrentReplyObservationPermit['responseTargetEligibility'],
          responseTargetStartAt: current.responseTargetStartAt,
        }
        return { status: 'current' as const, value: await apply(permit) }
      }),
    ),
})
