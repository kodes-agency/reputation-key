// Inbox context — get folder counts use case
// Returns counts for each folder in the email-style sidebar.
// Uses repository's countByStatus for each relevant status.

import type { InboxRepository } from '../ports/inbox.repository'
import type { OrganizationId, UserId } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'
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
}>

export const getInboxFolderCounts =
  (deps: GetInboxFolderCountsDeps) =>
  async (input: GetInboxFolderCountsInput): Promise<InboxFolderCounts> => {
    if (!can(input.role, 'inbox.read')) {
      throw inboxError('forbidden', 'No inbox read permission')
    }

    const [newCount, readCount, escalated, addressed, archived] = await Promise.all([
      deps.repo.countByStatus(input.organizationId, 'new'),
      deps.repo.countByStatus(input.organizationId, 'read'),
      deps.repo.countByStatus(input.organizationId, 'escalated'),
      deps.repo.countByStatus(input.organizationId, 'addressed'),
      deps.repo.countByStatus(input.organizationId, 'archived'),
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
