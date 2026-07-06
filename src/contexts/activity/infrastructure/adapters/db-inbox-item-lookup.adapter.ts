// Activity context — DB-backed inbox item lookup adapter
// Maps source context IDs (reviewId, feedbackId) → inboxItemId.
// Used by reply event handlers so reply activity entries appear
// in the inbox item timeline.

import type { InboxItemLookupPort } from '../../ports/inbox-item-lookup.port'
import type { Database } from '#/shared/db'
import { and, eq } from 'drizzle-orm'
import { inboxItems } from '#/shared/db/schema/inbox.schema'
import { activityError } from '../../domain/errors'

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
      // §13: surface DB failures as a typed error instead of silently returning
      // null, which is indistinguishable from a legitimate "no inbox item for
      // this source". Reply handlers propagate this to the event bus, so a
      // DB-down becomes a visible failure (logged + entry skipped) rather than a
      // silently mis-linked activity row. The not-found case (empty result) still
      // returns null above — only a thrown DB error reaches here.
      throw activityError('lookup_failed', 'Inbox item lookup failed', {
        sourceId,
        orgId,
        cause: e instanceof Error ? e.message : String(e),
      })
    }
  },
})
