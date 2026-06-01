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
    const item = await deps.repo.findById(input.inboxItemId, input.organizationId)
    if (!item) {
      throw inboxError('not_found', 'Inbox item not found', {
        inboxItemId: input.inboxItemId,
      })
    }

    if (!can(input.role, 'inbox.manage')) {
      const accessible = await deps.staffPublicApi.getAccessiblePropertyIds(
        input.organizationId,
        input.userId,
        input.role,
      )
      if (
        accessible !== null &&
        !accessible.includes(
          item.propertyId as ReturnType<typeof import('#/shared/domain/ids').propertyId>,
        )
      ) {
        throw inboxError('forbidden', 'No access to this property', {
          propertyId: item.propertyId,
        })
      }
    }

    return deps.noteRepo.findByInboxItemId(input.inboxItemId, input.organizationId)
  }

// fallow-ignore-next-line unused-type
export type GetInboxNotesUseCase = ReturnType<typeof getInboxNotes>
