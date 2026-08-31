import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { reviews } from '#/shared/db/schema/review.schema'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import type {
  ReviewCurrentSourceTransitionPermit,
  ReviewSourceTransitionAuthority,
  ReviewSourceTransitionExpectation,
} from '../application/ports/source-transition-authority.port'
import { runWithReviewExactCurrentApplyAdmission } from './exact-current-apply-admission'
import { lockReviewSourceMutationScope } from './review-source-mutation-serialization'

const sameInstant = (left: Date, right: Date): boolean =>
  left.getTime() === right.getTime()

/**
 * Review-owned exact-current source-transition authority.
 *
 * The canonical Property -> Reply truth -> Review lock prefix serializes this
 * validation with lifecycle expiry, provider deletion, and re-observation.
 * The Review row remains locked while the foreign callback commits, closing
 * the stale-event interval without exposing Review tables or transactions.
 */
export const createReviewSourceTransitionAuthority = (
  db: Database,
): ReviewSourceTransitionAuthority => ({
  withExactCurrent: async <T>(
    expectation: ReviewSourceTransitionExpectation,
    apply: (permit: ReviewCurrentSourceTransitionPermit) => Promise<T>,
  ) =>
    runWithReviewExactCurrentApplyAdmission(() =>
      db.transaction(async (tx) => {
        const scopeCurrent = await lockReviewSourceMutationScope(tx, {
          organizationId: organizationId(expectation.organizationId),
          propertyId: propertyId(expectation.propertyId),
          reviewId: reviewId(expectation.reviewId),
          sourceEpoch: expectation.sourceEpoch,
        })
        if (!scopeCurrent) return { status: 'obsolete' as const }

        const rows = await tx
          .select({
            organizationId: reviews.organizationId,
            propertyId: reviews.propertyId,
            reviewId: reviews.id,
            sourceEpoch: reviews.sourceEpoch,
            sourceRevision: reviews.sourceRevision,
            analysisSequence: reviews.analysisSequence,
            sourceContentState: reviews.sourceContentState,
            sourceContentErasedAt: reviews.sourceContentErasedAt,
          })
          .from(reviews)
          .where(
            and(
              eq(reviews.id, expectation.reviewId),
              eq(reviews.organizationId, expectation.organizationId),
              eq(reviews.propertyId, expectation.propertyId),
            ),
          )
          .for('update')
          .limit(1)
        const current = rows[0]
        if (
          current === undefined ||
          current.organizationId !== expectation.organizationId ||
          current.propertyId !== expectation.propertyId ||
          current.reviewId !== expectation.reviewId ||
          current.sourceEpoch !== expectation.sourceEpoch ||
          current.sourceRevision !== expectation.sourceRevision ||
          current.analysisSequence !== expectation.analysisSequence ||
          current.sourceContentState !== expectation.change ||
          !(current.sourceContentErasedAt instanceof Date) ||
          !sameInstant(current.sourceContentErasedAt, expectation.occurredAt)
        ) {
          return { status: 'obsolete' as const }
        }

        const permit: ReviewCurrentSourceTransitionPermit = {
          authority: 'review.current-source-transition.v1',
          organizationId: current.organizationId,
          propertyId: current.propertyId,
          reviewId: current.reviewId,
          sourceEpoch: current.sourceEpoch,
          sourceRevision: current.sourceRevision,
          analysisSequence: current.analysisSequence,
          change: expectation.change,
          occurredAt: current.sourceContentErasedAt,
        }
        return { status: 'current' as const, value: await apply(permit) }
      }),
    ),
})
