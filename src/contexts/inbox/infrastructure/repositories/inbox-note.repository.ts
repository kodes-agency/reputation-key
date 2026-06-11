// Inbox context — Drizzle inbox note repository implementation
// Per architecture: factory function returning Readonly<{ method }>.
// Wrapped in trace() for observability.

import { and, eq, desc } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { inboxNotes } from '#/shared/db/schema/inbox.schema'
import type { InboxNoteRepository } from '../../application/ports/inbox-note.repository'
import type { InboxNote } from '../../domain/types'
import type { InboxItemId, OrganizationId } from '#/shared/domain/ids'
import { inboxNoteFromRow, inboxNoteToInsertRow } from '../mappers/inbox-note.mapper'
import { trace } from '#/shared/observability/trace'
import { inboxError } from '../../domain/errors'

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

  create: async (note: InboxNote, orgId: OrganizationId) => {
    return trace('inboxNote.create', async () => {
      if (note.organizationId !== orgId) {
        throw inboxError('forbidden', 'InboxNote.create: tenant mismatch', {
          noteOrgId: note.organizationId as string,
          callerOrgId: orgId as string,
        })
      }
      const row = inboxNoteToInsertRow(note)
      const result = await db.insert(inboxNotes).values(row).returning()

      if (!result[0]) {
        throw inboxError('not_found', 'Inbox note insert failed — no row returned')
      }
      return inboxNoteFromRow(result[0])
    })
  },
})
