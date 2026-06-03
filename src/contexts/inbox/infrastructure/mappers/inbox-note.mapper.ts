// Inbox context — row ↔ domain mapper for inbox notes
// Per architecture: pure functions, the only place where both row and domain shapes are known.

import type { inboxNotes } from '#/shared/db/schema/inbox.schema'
import type { InboxNote } from '../../domain/types'
import { inboxNoteId, inboxItemId, organizationId, userId } from '#/shared/domain/ids'

type InboxNoteRow = typeof inboxNotes.$inferSelect
type InboxNoteInsertRow = typeof inboxNotes.$inferInsert

export const inboxNoteFromRow = (row: InboxNoteRow): InboxNote => ({
  id: inboxNoteId(row.id),
  inboxItemId: inboxItemId(row.inboxItemId),
  organizationId: organizationId(row.organizationId),
  userId: userId(row.userId),
  text: row.text,
  createdAt: row.createdAt,
})

export const inboxNoteToInsertRow = (
  note: Omit<InboxNote, 'createdAt'>,
): InboxNoteInsertRow => ({
  id: note.id as string,
  inboxItemId: note.inboxItemId as string,
  organizationId: note.organizationId as string,
  userId: note.userId as string,
  text: note.text,
})
