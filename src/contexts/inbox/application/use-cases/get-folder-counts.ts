// Inbox context — get folder counts use case
// Returns counts for each folder in the email-style sidebar.
// Uses repository's countByStatus for each relevant status.

import type { InboxRepository } from '../ports/inbox.repository'
import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { can } from '#/shared/domain/permissions'
import { inboxError } from '../../domain/errors'

export type InboxFolderCounts = Readonly<{
  inbox: number
  unaddressed: number
  escalated: number
  addressed: number
  archived: number
}>

export type GetInboxFolderCountsInput = Readonly<{
  organizationId: OrganizationId
  userId: UserId
  role: Role
}>

// fallow-ignore-next-line unused-type
export type GetInboxFolderCountsDeps = Readonly<{
  repo: InboxRepository
  staffPublicApi: StaffPublicApi
}>

export const getInboxFolderCounts =
  (deps: GetInboxFolderCountsDeps) =>
  async (input: GetInboxFolderCountsInput): Promise<InboxFolderCounts> => {
    if (!can(input.role, 'inbox.read')) {
      throw inboxError('forbidden', 'No inbox read permission')
    }

    // Resolve property scoping: AccountAdmin sees org-wide counts;
    // PropertyManager/Staff are scoped to their staff_assignment properties.
    // (PM holds inbox.manage but is NOT org-wide — CONTEXT.md L72.)
    let propertyIds: ReadonlyArray<PropertyId> | undefined
    if (input.role !== 'AccountAdmin') {
      const accessible = await deps.staffPublicApi.getAccessiblePropertyIds(
        input.organizationId,
        input.userId,
        false,
      )
      // No assignments → no visible items. The repo treats propertyIds=[] as
      // "no filter" (org-wide), so short-circuit to zeros to avoid leaking
      // org-wide counts to a scoped user with no property assignments.
      if (accessible !== null && accessible.length === 0) {
        return { inbox: 0, unaddressed: 0, escalated: 0, addressed: 0, archived: 0 }
      }
      propertyIds = accessible ?? undefined
    }

    const [newCount, readCount, escalated, addressed, archived] = await Promise.all([
      deps.repo.countByStatus(input.organizationId, 'new', propertyIds),
      deps.repo.countByStatus(input.organizationId, 'read', propertyIds),
      deps.repo.countByStatus(input.organizationId, 'escalated', propertyIds),
      deps.repo.countByStatus(input.organizationId, 'addressed', propertyIds),
      deps.repo.countByStatus(input.organizationId, 'archived', propertyIds),
    ])

    const unaddressed = newCount + readCount

    return {
      inbox: newCount + readCount + escalated + addressed + archived,
      unaddressed,
      escalated,
      addressed,
      archived,
    }
  }

// fallow-ignore-next-line unused-type
export type GetInboxFolderCounts = ReturnType<typeof getInboxFolderCounts>
