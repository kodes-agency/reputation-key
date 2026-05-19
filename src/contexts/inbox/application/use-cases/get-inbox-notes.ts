// Inbox context — get inbox notes use case
// Returns all notes for a single inbox item.

import type { InboxNoteRepository } from '../ports/inbox-note.repository'
import type { InboxItemId, OrganizationId } from '#/shared/domain/ids'
import type { InboxNote } from '../../domain/types'

export type GetInboxNotesInput = Readonly<{
  inboxItemId: InboxItemId
  organizationId: OrganizationId
}>

// fallow-ignore-next-line unused-type
export type GetInboxNotesDeps = Readonly<{
  noteRepo: InboxNoteRepository
}>

export const getInboxNotes =
  (deps: GetInboxNotesDeps) =>
  async (input: GetInboxNotesInput): Promise<ReadonlyArray<InboxNote>> => {
    return deps.noteRepo.findByInboxItemId(input.inboxItemId, input.organizationId)
  }

// fallow-ignore-next-line unused-type
export type GetInboxNotesUseCase = ReturnType<typeof getInboxNotes>
