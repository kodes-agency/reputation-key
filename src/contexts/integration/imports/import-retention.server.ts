import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { googleImportItems, googleImports } from '#/shared/db/schema/google-import.schema'
import { idempotencyReceipts } from '#/shared/db/schema/outbox.schema'
import { insertOutboxRow } from '#/shared/outbox/commit'
import type { GoogleImportV2Store } from '../application/ports/google-import-v2-store.port'
import {
  assertLifecycleSweepLimit,
  parentScope,
  retentionReleasedEvent,
} from './import-store-helpers.server'

export function createImportRetention(
  db: Database,
): Pick<GoogleImportV2Store, 'listPurgeCandidates' | 'purgeParent'> {
  return {
    listPurgeCandidates: async (now, limit) => {
      assertLifecycleSweepLimit(limit)
      const current = await db
        .select({
          organizationId: googleImports.organizationId,
          importJobId: googleImports.id,
          deletionFence: googleImports.deletionFence,
        })
        .from(googleImports)
        .where(
          and(
            lte(googleImports.purgeAt, now),
            sql`NOT EXISTS (
        SELECT 1 FROM ${googleImportItems} WHERE ${googleImportItems.organizationId} = ${googleImports.organizationId}
          AND ${googleImportItems.importId} = ${googleImports.id} AND ${googleImportItems.status} IN ('pending', 'processing')
      )`,
          ),
        )
        .orderBy(asc(googleImports.purgeAt), asc(googleImports.id))
        .limit(limit)
      return current
    },
    purgeParent: purgeCurrent,
  }

  function purgeCurrent(input: Parameters<GoogleImportV2Store['purgeParent']>[0]) {
    return db.transaction(async (tx) => {
      const [parent] = await tx
        .select()
        .from(googleImports)
        .where(
          and(
            parentScope(input.organizationId, input.importJobId),
            eq(googleImports.deletionFence, input.expectedDeletionFence),
            lte(googleImports.purgeAt, input.now),
          ),
        )
        .for('update')
        .limit(1)
      if (!parent) return 'lost' as const
      const items = await tx
        .select({ id: googleImportItems.id, status: googleImportItems.status })
        .from(googleImportItems)
        .where(
          and(
            eq(googleImportItems.organizationId, input.organizationId),
            eq(googleImportItems.importId, input.importJobId),
          ),
        )
        .orderBy(asc(googleImportItems.id))
        .for('update')
      if (
        items.length !== parent.totalCount ||
        items.some((item) => item.status === 'pending' || item.status === 'processing')
      ) {
        return 'lost' as const
      }
      // Release facts retain the existing bounded event contract. Every chunk,
      // retry receipt and the root cascade commit in the same transaction.
      for (let offset = 0; offset < items.length; offset += 100) {
        const itemIds = items.slice(offset, offset + 100).map((item) => item.id)
        await insertOutboxRow(
          tx,
          retentionReleasedEvent({
            eventId: offset === 0 ? input.outboxEventId : randomUUID(),
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
      }
      await tx
        .delete(googleImports)
        .where(
          and(
            parentScope(input.organizationId, input.importJobId),
            eq(googleImports.deletionFence, input.expectedDeletionFence),
          ),
        )
      return 'purged' as const
    })
  }
}
