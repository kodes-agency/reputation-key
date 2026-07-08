// Inbox context — get inbox notes use case
// Returns all notes for a single inbox item.
// Enforces role-scoped property access.

import type { InboxNoteRepository } from '../ports/inbox-note.repository'
import type { InboxRepository } from '../ports/inbox.repository'
import type { InboxItemId } from '#/shared/domain/ids'
import type { InboxNote } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { canForContext } from '#/shared/domain/permissions'
import { inboxError } from '../../domain/errors'
import { assertPropertyAccessible } from '../inbox-access'

export type GetInboxNotesInput = Readonly<{
  inboxItemId: InboxItemId
}>

// fallow-ignore-next-line unused-type
export type GetInboxNotesDeps = Readonly<{
  noteRepo: InboxNoteRepository
  repo: InboxRepository
  staffPublicApi: StaffPublicApi
}>

export const getInboxNotes =
  (deps: GetInboxNotesDeps) =>
  async (
    input: GetInboxNotesInput,
    ctx: AuthContext,
  ): Promise<ReadonlyArray<InboxNote>> => {
    if (!canForContext(ctx, 'inbox.read')) {
      throw inboxError('forbidden', 'Insufficient role to read inbox notes')
    }

    const item = await deps.repo.findById(input.inboxItemId, ctx.organizationId)
    if (!item) {
      throw inboxError('not_found', 'Inbox item not found', {
        inboxItemId: input.inboxItemId,
      })
    }

    // Enforce role-scoped property access via the shared guard.
    // Scope resolved per-permission: org-wide (AccountAdmin) → all accessible;
    // assigned scope (PropertyManager/Staff) → staff_assignment properties
    // (CONTEXT.md L72).
    await assertPropertyAccessible(
      deps.staffPublicApi,
      ctx,
      'inbox.read',
      item.propertyId,
    )

    return deps.noteRepo.findByInboxItemId(input.inboxItemId, ctx.organizationId)
  }

// fallow-ignore-next-line unused-type
export type GetInboxNotesUseCase = ReturnType<typeof getInboxNotes>
