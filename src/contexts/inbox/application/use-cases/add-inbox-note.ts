// Inbox context — add inbox note use case
// Adds a note to an inbox item.

import type { InboxRepository } from '../ports/inbox.repository'
import type { InboxNoteRepository } from '../ports/inbox-note.repository'
import type { InboxItemId, InboxNoteId, OrganizationId, UserId } from '#/shared/domain/ids'
import type { InboxNote } from '../../domain/types'
import { createInboxNote } from '../../domain/constructors'
import { inboxError } from '../../domain/errors'

export type AddInboxNoteInput = Readonly<{
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  authorUserId: UserId
  text: string
}>

// fallow-ignore-next-line unused-type
export type AddInboxNoteDeps = Readonly<{
  repo: InboxRepository
  noteRepo: InboxNoteRepository
  idGen: () => InboxNoteId
  clock: () => Date
}>

export const addInboxNote =
  (deps: AddInboxNoteDeps) =>
  async (input: AddInboxNoteInput): Promise<InboxNote> => {
    // 1. Find item
    const item = await deps.repo.findById(input.inboxItemId, input.organizationId)
    if (!item) {
      throw inboxError('not_found', 'Inbox item not found', {
        inboxItemId: input.inboxItemId,
      })
    }

    // 2. Build domain note
    const result = createInboxNote({
      id: deps.idGen(),
      inboxItemId: input.inboxItemId,
      organizationId: input.organizationId,
      authorUserId: input.authorUserId,
      text: input.text,
      clock: deps.clock,
    })

    if (result.isErr()) {
      throw result.error
    }

    const note = result.value

    // 3. Persist
    await deps.noteRepo.create(note)

    // 4. Return
    return note
  }

// fallow-ignore-next-line unused-type
export type AddInboxNote = ReturnType<typeof addInboxNote>
