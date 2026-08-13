import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  gbpImportRequestItems,
  gbpImportRequests,
} from '#/shared/db/schema/google-import-v2.schema'
import type { ImportItemRoutingRecord } from '#/shared/routing/processing-router'

const ACTIVE_ITEM_STATUSES = ['pending', 'processing'] as const

/**
 * Tenant-keyed content-free routing lookup for delayed import-item work.
 * Terminal, purged, cross-tenant, or deleted-parent items deliberately look missing.
 */
export function createImportItemRoutingLoader(deps: Readonly<{ db: Database }>) {
  return async (
    organizationId: string,
    itemId: string,
  ): Promise<ImportItemRoutingRecord | null> => {
    const [row] = await deps.db
      .select({
        processingRegion: gbpImportRequestItems.processingRegion,
        routingPolicyVersion: gbpImportRequestItems.routingPolicyVersion,
      })
      .from(gbpImportRequestItems)
      .innerJoin(
        gbpImportRequests,
        and(
          eq(gbpImportRequests.id, gbpImportRequestItems.importJobId),
          eq(gbpImportRequests.organizationId, gbpImportRequestItems.organizationId),
        ),
      )
      .where(
        and(
          eq(gbpImportRequestItems.organizationId, organizationId),
          eq(gbpImportRequestItems.id, itemId),
          inArray(gbpImportRequestItems.status, ACTIVE_ITEM_STATUSES),
        ),
      )
      .limit(1)

    return row ?? null
  }
}
