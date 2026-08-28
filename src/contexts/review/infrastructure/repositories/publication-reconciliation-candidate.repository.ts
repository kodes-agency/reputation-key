import { and, asc, eq, isNotNull, lte, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { replies } from '#/shared/db/schema/review.schema'
import { organizationId, replyId } from '#/shared/domain/ids'
import type {
  AmbiguousPublicationReconciliationCandidate,
  PublicationReconciliationCandidateQuery,
} from '../../application/ports/publication-reconciliation-maintenance.port'
import { trace } from '#/shared/observability/trace'

function candidateFromRow(row: {
  replyId: string
  organizationId: string
  publicationState: string | null
  reconcileDueAt: Date | null
}): AmbiguousPublicationReconciliationCandidate {
  if (row.publicationState !== 'ambiguous') {
    throw new Error('ambiguous publication candidate query returned another state')
  }
  if (row.reconcileDueAt == null || Number.isNaN(row.reconcileDueAt.getTime())) {
    throw new Error('ambiguous publication candidate is missing due time')
  }
  return {
    replyId: replyId(row.replyId),
    organizationId: organizationId(row.organizationId),
    publicationState: 'ambiguous',
    reconcileDueAt: row.reconcileDueAt,
  }
}

/**
 * Identifier/timing-only PostgreSQL adapter for operator reconciliation.
 * The explicit projection is a privacy boundary: provider and Reply content
 * are never selected, mapped, or returned.
 */
export const createPublicationReconciliationCandidateQuery = (
  db: Database,
): PublicationReconciliationCandidateQuery => ({
  findAmbiguousCandidates: ({ dueThrough, after, limit }) =>
    trace('reply.findAmbiguousPublicationReconciliationCandidates', async () => {
      const rows = await db
        .select({
          replyId: replies.id,
          organizationId: replies.organizationId,
          publicationState: replies.publicationState,
          reconcileDueAt: replies.reconcileDueAt,
        })
        .from(replies)
        .where(
          and(
            eq(replies.publicationState, 'ambiguous'),
            isNotNull(replies.reconcileDueAt),
            lte(replies.reconcileDueAt, dueThrough),
            after
              ? sql`(${replies.reconcileDueAt}, ${replies.id}) > (${after.reconcileDueAt}, ${after.replyId})`
              : undefined,
          ),
        )
        .orderBy(asc(replies.reconcileDueAt), asc(replies.id))
        .limit(limit)

      return rows.map((row) =>
        candidateFromRow({
          replyId: row.replyId,
          organizationId: row.organizationId,
          publicationState: row.publicationState,
          // The WHERE clause proves non-null; the mapper still fails closed
          // if an adapter/mock ever violates that SQL contract.
          reconcileDueAt: row.reconcileDueAt,
        }),
      )
    }),
})
