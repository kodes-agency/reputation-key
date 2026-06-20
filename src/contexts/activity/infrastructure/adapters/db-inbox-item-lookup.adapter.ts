// Activity context — DB-backed inbox item lookup adapter
// Maps source context IDs (reviewId, feedbackId) → inboxItemId.
// Used by reply event handlers so reply activity entries appear
// in the inbox item timeline.

import type { InboxItemLookupPort } from '../../ports/inbox-item-lookup.port'
import type { Database } from '#/shared/db'
import { and, eq } from 'drizzle-orm'
import { inboxItems } from '#/shared/db/schema/inbox.schema'
import { getLogger } from '#/shared/observability/logger'

export const createDbInboxItemLookupAdapter = (db: Database): InboxItemLookupPort => ({
  findBySourceId: async (sourceId, orgId): Promise<string | null> => {
    try {
      const rows = await db
        .select({ id: inboxItems.id })
        .from(inboxItems)
        .where(
          and(eq(inboxItems.sourceId, sourceId), eq(inboxItems.organizationId, orgId)),
        )
        .limit(1)
      return rows[0]?.id ?? null
    } catch (e) {
      getLogger().warn(
        { err: e, sourceId, orgId },
        'DB inbox item lookup failed, returning null',
      )
      return null
    }
  },
})
