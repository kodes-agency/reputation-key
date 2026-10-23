import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { reviewSourceObservations } from '#/shared/db/schema/review.schema'
import { reviewId } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import type { RestatedRevisionQuery } from '../../application/ports/restated-revision-maintenance.port'

type RestatedRow = Readonly<{
  review_id: string
  source_epoch: number
  revision: number | string
}>

/**
 * The Material Review Revisions Google only restated: the observation that
 * created the revision (`material_change`) carries the same Google `updateTime`
 * as the last applied observation before it, in the same source epoch. It is the
 * stage-A restatement rule applied to history. It reads `material_change`
 * observations only: from the rule on, a restatement is stored as
 * `normalization_shadow_match` and creates no revision, so nothing here depends
 * on a stored restatement value.
 *
 * The previous observation is the nearest earlier one that was not recorded as
 * `out_of_order_ignored`: the rule compares with the stored head, and an
 * observation older than the head never moved it. Both times must be known; an
 * observation whose provider content was erased has none and cannot qualify.
 *
 * Identifiers and numbers only: the projection never selects Review content.
 */
export const createRestatedRevisionQuery = (db: Database): RestatedRevisionQuery => ({
  listRestatedRevisions: ({ organizationId, propertyId }) =>
    trace('review.listRestatedRevisions', async () => {
      const result = await db.execute<RestatedRow>(sql`
        SELECT DISTINCT
          created.review_id,
          created.source_epoch,
          created.material_revision AS revision
        FROM ${reviewSourceObservations} created
        INNER JOIN LATERAL (
          SELECT earlier.source_epoch, earlier.source_updated_at
          FROM ${reviewSourceObservations} earlier
          WHERE earlier.organization_id = created.organization_id
            AND earlier.property_id = created.property_id
            AND earlier.review_id = created.review_id
            AND earlier.observation_sequence < created.observation_sequence
            AND earlier.comparison_result <> 'out_of_order_ignored'
          ORDER BY earlier.observation_sequence DESC
          LIMIT 1
        ) previous ON TRUE
        WHERE created.organization_id = ${organizationId}
          AND created.property_id = ${propertyId}
          AND created.comparison_result = 'material_change'
          AND created.source_updated_at IS NOT NULL
          AND previous.source_updated_at IS NOT NULL
          AND previous.source_epoch = created.source_epoch
          AND previous.source_updated_at = created.source_updated_at
        ORDER BY created.review_id, revision
      `)
      return result.rows.map((row) => ({
        reviewId: reviewId(row.review_id),
        sourceEpoch: Number(row.source_epoch),
        revision: Number(row.revision),
      }))
    }),
})
