import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { POOL_MAX_CONNECTIONS } from '#/shared/db/pool'
import {
  googleReplyObservationHeads,
  googleReplyObservations,
  reviews,
} from '#/shared/db/schema/review.schema'
import { organizationId, reviewId } from '#/shared/domain/ids'
import type {
  ReviewCurrentReplyObservationPermit,
  ReviewReplyObservationAuthority,
  ReviewReplyObservationExpectation,
} from '../application/ports/reply-observation-authority.port'
import { lockReplyTruthScope } from './reply-truth-serialization'

const sameInstant = (left: Date, right: Date): boolean =>
  left.getTime() === right.getTime()

/** One exact-current apply holds the Review transaction while its Inbox
 * callback opens the consumer-owned transaction, so it can require two pool
 * clients at the same time. Keep process-wide admission below pool capacity;
 * queued callers hold no database client. */
export const REPLY_OBSERVATION_APPLY_CLIENTS = 2
const REPLY_OBSERVATION_POOL_HEADROOM = 2
export const REPLY_OBSERVATION_MAX_CONCURRENT_APPLIES = Math.max(
  1,
  Math.floor(
    (POOL_MAX_CONNECTIONS - REPLY_OBSERVATION_POOL_HEADROOM) /
      REPLY_OBSERVATION_APPLY_CLIENTS,
  ),
)

type ApplyAdmission = Readonly<{
  run<T>(apply: () => Promise<T>): Promise<T>
}>

const REPLY_OBSERVATION_APPLY_ADMISSION_KEY = Symbol.for(
  'repkey.review.reply-observation-apply-admission',
)

// Deliberately process-lifetime, matching the process-owned DB pool. Symbol.for
// plus globalThis makes duplicate module instances share one admission budget;
// the gate owns no external resource and every run releases its slot in finally.

const createBoundedApplyAdmission = (limit: number): ApplyAdmission => {
  let active = 0
  const waiters: Array<() => void> = []
  const acquire = (): Promise<void> => {
    if (active < limit) {
      active += 1
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      waiters.push(() => {
        active += 1
        resolve()
      })
    })
  }
  const release = (): void => {
    active -= 1
    waiters.shift()?.()
  }
  return {
    run: async <T>(apply: () => Promise<T>): Promise<T> => {
      await acquire()
      try {
        return await apply()
      } finally {
        release()
      }
    },
  }
}

const getReplyObservationApplyAdmission = (): ApplyAdmission => {
  const processStore = globalThis as unknown as {
    [key: symbol]: ApplyAdmission | undefined
  }
  const existing = processStore[REPLY_OBSERVATION_APPLY_ADMISSION_KEY]
  if (existing) return existing
  const created = createBoundedApplyAdmission(REPLY_OBSERVATION_MAX_CONCURRENT_APPLIES)
  processStore[REPLY_OBSERVATION_APPLY_ADMISSION_KEY] = created
  return created
}

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
    getReplyObservationApplyAdmission().run(() =>
      db.transaction(async (tx) => {
        await lockReplyTruthScope(
          tx,
          organizationId(expectation.organizationId),
          reviewId(expectation.reviewId),
        )

        const rows = await tx
          .select({
            organizationId: googleReplyObservationHeads.organizationId,
            propertyId: googleReplyObservationHeads.propertyId,
            reviewId: googleReplyObservationHeads.reviewId,
            observationRevision: googleReplyObservationHeads.observationRevision,
            sourceEpoch: googleReplyObservationHeads.sourceEpoch,
            materialReviewRevision: googleReplyObservationHeads.materialReviewRevision,
            currentReviewSourceEpoch: reviews.sourceEpoch,
            currentReviewMaterialReviewRevision: reviews.sourceRevision,
            headState: googleReplyObservationHeads.state,
            headProvenance: googleReplyObservationHeads.provenance,
            state: googleReplyObservations.state,
            change: googleReplyObservations.change,
            resolution: googleReplyObservations.resolution,
            provenance: googleReplyObservations.provenance,
            matchedReplyId: googleReplyObservations.matchedReplyId,
            matchedPublicationCycle: googleReplyObservations.matchedPublicationCycle,
            observedAt: googleReplyObservations.observedAt,
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
          .where(
            and(
              eq(googleReplyObservationHeads.reviewId, expectation.reviewId),
              eq(googleReplyObservationHeads.organizationId, expectation.organizationId),
            ),
          )
          .for('update', { of: googleReplyObservationHeads })
          .limit(1)
        const current = rows[0]
        const exact =
          current !== undefined &&
          current.organizationId === expectation.organizationId &&
          current.propertyId === expectation.propertyId &&
          current.reviewId === expectation.reviewId &&
          current.observationRevision === expectation.observationRevision &&
          current.sourceEpoch === expectation.sourceEpoch &&
          current.materialReviewRevision === expectation.materialReviewRevision &&
          current.currentReviewSourceEpoch === expectation.sourceEpoch &&
          current.currentReviewMaterialReviewRevision ===
            expectation.materialReviewRevision &&
          current.headState === current.state &&
          current.headProvenance === current.provenance &&
          current.change === expectation.change &&
          current.resolution === expectation.resolution &&
          current.provenance === expectation.provenance &&
          current.matchedReplyId === expectation.matchedReplyId &&
          current.matchedPublicationCycle === expectation.matchedPublicationCycle &&
          (current.state === 'live' || current.state === 'absent') &&
          sameInstant(current.observedAt, expectation.occurredAt)

        if (!exact) return { status: 'obsolete' as const }

        const permit: ReviewCurrentReplyObservationPermit = {
          authority: 'review.current-google-reply-observation.v1',
          organizationId: current.organizationId,
          propertyId: current.propertyId,
          reviewId: current.reviewId,
          observationRevision: current.observationRevision,
          sourceEpoch: current.sourceEpoch,
          materialReviewRevision: current.materialReviewRevision,
          state: current.state === 'live' ? 'live' : 'absent',
          change: expectation.change,
          resolution: expectation.resolution,
          provenance: expectation.provenance,
          matchedReplyId: current.matchedReplyId,
          matchedPublicationCycle: current.matchedPublicationCycle,
          observedAt: current.observedAt,
        }
        return { status: 'current' as const, value: await apply(permit) }
      }),
    ),
})
