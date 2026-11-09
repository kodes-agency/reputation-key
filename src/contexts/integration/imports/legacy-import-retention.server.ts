import { asc, and, eq, inArray, lte, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  gbpImportRequestItems,
  gbpImportRequests,
  gbpImportSagas,
} from '#/shared/db/schema/google-import-v2.schema'
import { idempotencyReceipts } from '#/shared/db/schema/outbox.schema'
import { insertOutboxRow } from '#/shared/outbox/commit'
import type { GoogleImportV2Store } from '../application/ports/google-import-v2-store.port'
import {
  assertLifecycleSweepLimit,
  retentionReleasedEvent,
} from './import-store-helpers.server'

/**
 * Imports finished before the single-root store keep their 30-day promise: the
 * same bounded purge removes their history once it is past purge time. Nothing
 * writes these tables any more.
 */
export function createLegacyImportRetention(
  db: Database,
): Pick<GoogleImportV2Store, 'listPurgeCandidates' | 'purgeParent'> {
  return {
    listPurgeCandidates: async (now, limit) => {
      assertLifecycleSweepLimit(limit)
      return db
        .select({
          organizationId: gbpImportRequests.organizationId,
          importJobId: gbpImportRequests.id,
          deletionFence: gbpImportRequests.deletionFence,
        })
        .from(gbpImportRequests)
        .where(
          and(
            sql`${gbpImportRequests.status} NOT IN ('queued', 'processing')`,
            lte(gbpImportRequests.purgeAt, now),
          ),
        )
        .orderBy(asc(gbpImportRequests.purgeAt), asc(gbpImportRequests.id))
        .limit(limit)
    },
    purgeParent: (input) =>
      db.transaction(async (tx) => {
        const itemRows = await tx
          .select({ itemId: gbpImportRequestItems.id })
          .from(gbpImportRequestItems)
          .where(
            and(
              eq(gbpImportRequestItems.organizationId, input.organizationId),
              eq(gbpImportRequestItems.importJobId, input.importJobId),
            ),
          )
          .orderBy(asc(gbpImportRequestItems.id))
          .for('update')
          .limit(101)
        if (itemRows.length < 1 || itemRows.length > 100) return 'lost' as const

        const [parent] = await tx
          .select({
            totalCount: gbpImportRequests.totalCount,
            sagaId: gbpImportRequests.sagaId,
          })
          .from(gbpImportRequests)
          .where(
            and(
              eq(gbpImportRequests.organizationId, input.organizationId),
              eq(gbpImportRequests.id, input.importJobId),
              eq(gbpImportRequests.deletionFence, input.expectedDeletionFence),
              sql`${gbpImportRequests.status} NOT IN ('queued', 'processing')`,
              lte(gbpImportRequests.purgeAt, input.now),
            ),
          )
          .for('update')
          .limit(1)
        if (!parent || parent.totalCount !== itemRows.length) return 'lost' as const

        const itemIds = itemRows.map((row) => row.itemId)
        await insertOutboxRow(
          tx,
          retentionReleasedEvent({
            eventId: input.outboxEventId,
            organizationId: input.organizationId,
            importJobId: input.importJobId,
            itemIds,
            now: input.now,
          }),
          { recordedAt: input.now },
        )
        await tx
          .delete(idempotencyReceipts)
          .where(
            and(
              eq(idempotencyReceipts.scope, 'gbp_import_item_retry'),
              sql`${idempotencyReceipts.payload}->>'organizationId' = ${input.organizationId}`,
              inArray(sql<string>`${idempotencyReceipts.payload}->>'itemId'`, itemIds),
            ),
          )
        const [deleted] = await tx
          .delete(gbpImportRequests)
          .where(
            and(
              eq(gbpImportRequests.organizationId, input.organizationId),
              eq(gbpImportRequests.id, input.importJobId),
              eq(gbpImportRequests.deletionFence, input.expectedDeletionFence),
            ),
          )
          .returning({ id: gbpImportRequests.id })
        if (!deleted) return 'lost' as const
        if (parent.sagaId) {
          await tx.delete(gbpImportSagas).where(
            and(
              eq(gbpImportSagas.organizationId, input.organizationId),
              eq(gbpImportSagas.id, parent.sagaId),
              sql`NOT EXISTS (
                  SELECT 1 FROM ${gbpImportRequests}
                  WHERE ${gbpImportRequests.organizationId} = ${input.organizationId}
                    AND ${gbpImportRequests.sagaId} = ${parent.sagaId}
                )`,
            ),
          )
        }
        return 'purged' as const
      }),
  }
}
