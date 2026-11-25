import { and, asc, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  materialReviewRevisions,
  reviewSourceObservations,
} from '#/shared/db/schema/review.schema'
import type { OrganizationId, ReviewId } from '#/shared/domain/ids'

/** A Review's observation rows in sequence order, tenant-scoped, as stored. */
export async function readObservationHistory(
  db: Database,
  reviewId: ReviewId,
  organizationId: OrganizationId,
) {
  const rows = await db
    .select()
    .from(reviewSourceObservations)
    .where(
      and(
        eq(reviewSourceObservations.reviewId, reviewId),
        eq(reviewSourceObservations.organizationId, organizationId),
      ),
    )
    .orderBy(asc(reviewSourceObservations.observationSequence))
  return rows.map((row) => ({ ...row, comparison: row.comparisonResult }))
}

/** A Review's material revisions in revision order, tenant-scoped, as stored. */
export async function readMaterialRevisions(
  db: Database,
  reviewId: ReviewId,
  organizationId: OrganizationId,
) {
  return db
    .select()
    .from(materialReviewRevisions)
    .where(
      and(
        eq(materialReviewRevisions.reviewId, reviewId),
        eq(materialReviewRevisions.organizationId, organizationId),
      ),
    )
    .orderBy(asc(materialReviewRevisions.revision))
}
