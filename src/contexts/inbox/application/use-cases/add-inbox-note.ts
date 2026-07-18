// Inbox context — add inbox note use case
// Adds a note to an inbox item.

import type { InboxRepository } from '../ports/inbox.repository'
import type { InboxCommandStore } from '../ports/inbox-command-store.port'
import type { InboxItemId, InboxNoteId } from '#/shared/domain/ids'
import type { InboxNote } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { createInboxNote } from '../../domain/constructors'
import { inboxError } from '../../domain/errors'
import { loadInboxItemOrThrow, assertPropertyAccessible } from '../inbox-access'
import { canForContext } from '#/shared/domain/permissions'
import { inboxNoteAdded } from '../../domain/events'

export type AddInboxNoteInput = Readonly<{
  inboxItemId: InboxItemId
  text: string
}>

// fallow-ignore-next-line unused-type
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
    if (!canForContext(ctx, 'inbox.write')) {
      throw inboxError('forbidden', 'No inbox write permission')
    }
    // 1. Find item + enforce role-scoped property access
    const item = await loadInboxItemOrThrow(
      deps.repo,
      input.inboxItemId,
      ctx.organizationId,
    )
    await assertPropertyAccessible(
      deps.staffPublicApi,
      ctx,
      'inbox.write',
      item.propertyId,
    )

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

// fallow-ignore-next-line unused-type
export type AddInboxNote = ReturnType<typeof addInboxNote>
