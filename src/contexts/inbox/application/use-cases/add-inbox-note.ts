// Inbox context — add inbox note use case
// Adds a note to an inbox item.

import type { InboxRepository } from '../ports/inbox.repository'
import type { InboxNoteRepository } from '../ports/inbox-note.repository'
import type { InboxItemId, InboxNoteId } from '#/shared/domain/ids'
import type { InboxNote } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { EventBus } from '#/shared/events/event-bus'
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
  noteRepo: InboxNoteRepository
  idGen: () => InboxNoteId
  clock: () => Date
  staffPublicApi: StaffPublicApi
  events: EventBus
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

    // 3. Persist
    await deps.noteRepo.create(note, ctx.organizationId)

    // 4. Emit event
    await deps.events.emit(
      inboxNoteAdded({
        inboxItemId: note.inboxItemId,
        organizationId: note.organizationId,
        propertyId: item.propertyId,
        userId: note.userId,
        noteId: note.id,
        text: note.text,
        source: 'web',
        occurredAt: note.createdAt,
      }),
    )

    // 5. Return
    return note
  }

// fallow-ignore-next-line unused-type
export type AddInboxNote = ReturnType<typeof addInboxNote>
