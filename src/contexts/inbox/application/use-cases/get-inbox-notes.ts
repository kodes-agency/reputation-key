// Inbox context — get inbox notes use case
// Returns all notes for a single inbox item.
// Enforces role-scoped property access.

import type { InboxNoteRepository } from '../ports/inbox-note.repository'
import type { InboxRepository } from '../ports/inbox.repository'
import type { InboxItemId, OrganizationId, UserId } from '#/shared/domain/ids'
import type { InboxNote } from '../../domain/types'
import type { Role } from '#/shared/domain/roles'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { can } from '#/shared/domain/permissions'
import { inboxError } from '../../domain/errors'
import { assertPropertyAccessible } from '../inbox-access'

export type GetInboxNotesInput = Readonly<{
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  userId: UserId
  role: Role
}>

// fallow-ignore-next-line unused-type
export type GetInboxNotesDeps = Readonly<{
  noteRepo: InboxNoteRepository
  repo: InboxRepository
  staffPublicApi: StaffPublicApi
}>

export const getInboxNotes =
  (deps: GetInboxNotesDeps) =>
  async (input: GetInboxNotesInput): Promise<ReadonlyArray<InboxNote>> => {
    if (!can(input.role, 'inbox.read')) {
      throw inboxError('forbidden', 'Insufficient role to read inbox notes')
    }

    const item = await deps.repo.findById(input.inboxItemId, input.organizationId)
    if (!item) {
      throw inboxError('not_found', 'Inbox item not found', {
        inboxItemId: input.inboxItemId,
      })
    }

    // Enforce role-scoped property access via the shared guard.
    // AccountAdmin bypasses; PropertyManager/Staff are scoped to their
    // staff_assignment properties (CONTEXT.md L72).
    await assertPropertyAccessible(
      deps.staffPublicApi,
      input.organizationId,
      input.userId,
      input.role,
      item.propertyId,
    )

    return deps.noteRepo.findByInboxItemId(input.inboxItemId, input.organizationId)
  }

// fallow-ignore-next-line unused-type
export type GetInboxNotesUseCase = ReturnType<typeof getInboxNotes>
