// Inbox context — Drizzle inbox-view repository implementation
// Stores the per-user lastInboxView timestamp (ADR 0023).

import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { inboxUserViews } from '#/shared/db/schema/inbox.schema'
import type { InboxViewRepository } from '../../application/ports/inbox-view.repository'
import type { OrganizationId, UserId } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'

export const createInboxViewRepository = (db: Database): InboxViewRepository => ({
  getLastInboxView: async (orgId: OrganizationId, userId: UserId) => {
    return trace('inbox.getLastInboxView', async () => {
      const rows = await db
        .select({ lastInboxView: inboxUserViews.lastInboxView })
        .from(inboxUserViews)
        .where(
          and(
            eq(inboxUserViews.organizationId, orgId),
            eq(inboxUserViews.userId, userId),
          ),
        )
        .limit(1)
      return rows[0]?.lastInboxView ?? null
    })
  },

  stampLastInboxView: async (orgId: OrganizationId, userId: UserId, now?: Date) => {
    return trace('inbox.stampLastInboxView', async () => {
      const stamp = now ?? new Date()
      // Upsert: insert or update the single per-user row.
      await db
        .insert(inboxUserViews)
        .values({
          organizationId: orgId,
          userId,
          lastInboxView: stamp,
          updatedAt: stamp,
        })
        .onConflictDoUpdate({
          target: [inboxUserViews.organizationId, inboxUserViews.userId],
          set: { lastInboxView: stamp, updatedAt: stamp },
        })
      return stamp
    })
  },
})
