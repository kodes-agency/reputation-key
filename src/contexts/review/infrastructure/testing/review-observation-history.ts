import { and, asc, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { reviewSourceObservations } from '#/shared/db/schema/review.schema'
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
