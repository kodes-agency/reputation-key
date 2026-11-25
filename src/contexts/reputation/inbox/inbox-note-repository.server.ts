// Inbox context — Drizzle inbox note repository implementation
// Per architecture: factory function returning Readonly<{ method }>.
// Wrapped in trace() for observability.

import { and, eq, desc } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { inboxNotes } from '#/shared/db/schema/inbox-workspace.schema'
import type { InboxNoteRepository } from '#/contexts/reputation/inbox/inbox-note-repository.port.server'
import type { InboxItemId, OrganizationId } from '#/shared/domain/ids'
import { inboxNoteFromRow } from '#/contexts/reputation/inbox/inbox-note-mapper.server'
import { trace } from '#/shared/observability/trace'

export const createInboxNoteRepository = (db: Database): InboxNoteRepository => ({
  findByInboxItemId: async (itemId: InboxItemId, orgId: OrganizationId) => {
    return trace('inboxNote.findByInboxItemId', async () => {
      const rows = await db
        .select()
        .from(inboxNotes)
        .where(
          and(eq(inboxNotes.inboxItemId, itemId), eq(inboxNotes.organizationId, orgId)),
        )
        .orderBy(desc(inboxNotes.createdAt))
      return rows.map(inboxNoteFromRow)
    })
  },
})
