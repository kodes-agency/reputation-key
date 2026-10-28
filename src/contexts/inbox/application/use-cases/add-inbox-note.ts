// Inbox context — add inbox note use case
// Adds a note to an inbox item.

import type { InboxRepository } from '../ports/inbox.repository'
import type { InboxCommandStore } from '../ports/inbox-command-store.port'
import type { InboxItemId, InboxNoteId } from '#/shared/domain/ids'
import type { InboxNote } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { createInboxNote } from '../../domain/constructors'
import { loadItemForCommand } from '../inbox-access'
import { inboxNoteAdded } from '../../domain/events'

export type AddInboxNoteInput = Readonly<{
  inboxItemId: InboxItemId
  text: string
  expectedCommandRevision: number
}>

export type AddInboxNoteDeps = Readonly<{
  repo: InboxRepository
  commandStore: InboxCommandStore
  idGen: () => InboxNoteId
  clock: () => Date
  staffPublicApi: StaffPublicApi
}>

export const addInboxNote =
  (deps: AddInboxNoteDeps) =>
  async (input: AddInboxNoteInput, ctx: AuthContext): Promise<InboxNote> => {
    // 1. Write permission, the item, its source and Property scope, then the
    //    revision fence — the order every single-item command shares.
    const item = await loadItemForCommand(deps, input, ctx)

    // 2. Build domain note
    const result = createInboxNote({
      id: deps.idGen(),
      inboxItemId: input.inboxItemId,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      text: input.text,
      clock: deps.clock,
    })

    if (result.isErr()) {
      throw result.error
    }

    const note = result.value

    // 3. Persist + record the fact atomically. Notes remain context-owned
    //    content — the event carries the note ID, never the text (BQC-3.4).
    return deps.commandStore.addNote(
      item,
      note,
      inboxNoteAdded({
        inboxItemId: note.inboxItemId,
        organizationId: note.organizationId,
        propertyId: item.propertyId,
        userId: note.userId,
        noteId: note.id,
        source: 'web',
        occurredAt: note.createdAt,
      }),
    )
  }

export type AddInboxNote = ReturnType<typeof addInboxNote>
