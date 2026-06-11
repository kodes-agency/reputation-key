// Activity context — DB-backed inbox item lookup adapter
// Maps source context IDs (reviewId, feedbackId) → inboxItemId.
// Used by reply event handlers so reply activity entries appear
// in the inbox item timeline.

import type { InboxItemLookupPort } from '../../ports/inbox-item-lookup.port'
import type { Database } from '#/shared/db'
import { sql } from 'drizzle-orm'
import { getLogger } from '#/shared/observability/logger'

export const createDbInboxItemLookupAdapter = (db: Database): InboxItemLookupPort => ({
  findBySourceId: async (sourceId, orgId): Promise<string | null> => {
    try {
      const rows = await db.execute(sql`
        SELECT id FROM inbox_items
        WHERE source_id = ${sourceId} AND organization_id = ${orgId}
        LIMIT 1
      `)
      const row = rows.rows?.[0]
      if (!row) return null
      return (row as Record<string, unknown>).id as string
    } catch (e) {
      getLogger().warn(
        { err: e, sourceId, orgId },
        'DB inbox item lookup failed, returning null',
      )
      return null
    }
  },
})
