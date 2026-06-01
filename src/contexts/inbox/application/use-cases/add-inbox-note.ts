// Inbox context — add inbox note use case
// Adds a note to an inbox item.

import type { InboxRepository } from '../ports/inbox.repository'
import type { InboxNoteRepository } from '../ports/inbox-note.repository'
import type {
  InboxItemId,
  InboxNoteId,
  OrganizationId,
  UserId,
} from '#/shared/domain/ids'
import type { InboxNote } from '../../domain/types'
import type { Role } from '#/shared/domain/roles'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { createInboxNote } from '../../domain/constructors'
import { inboxError } from '../../domain/errors'
import { can } from '#/shared/domain/permissions'

export type AddInboxNoteInput = Readonly<{
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  authorUserId: UserId
  text: string
  role: Role
}>

// fallow-ignore-next-line unused-type
export type AddInboxNoteDeps = Readonly<{
  repo: InboxRepository
  noteRepo: InboxNoteRepository
  idGen: () => InboxNoteId
  clock: () => Date
  staffPublicApi: StaffPublicApi
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

    // Enforce role-scoped property access
    if (!can(input.role, 'inbox.manage')) {
      const accessible = await deps.staffPublicApi.getAccessiblePropertyIds(
        input.organizationId,
        input.authorUserId,
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
