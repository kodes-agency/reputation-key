// Inbox context — get inbox item detail use case
// Returns full detail view (item + source data) for a single inbox item.
// Enforces role-scoped property access.

import type { InboxRepository } from '../ports/inbox.repository'
import type { InboxItemId, OrganizationId, UserId } from '#/shared/domain/ids'
import type { InboxItemDetail } from '../../domain/types'
import type { Role } from '#/shared/domain/roles'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { can } from '#/shared/domain/permissions'
import { inboxError } from '../../domain/errors'
import { assertPropertyAccessible } from '../inbox-access'

export type GetInboxItemDetailInput = Readonly<{
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  userId: UserId
  role: Role
}>

// fallow-ignore-next-line unused-type
export type GetInboxItemDetailDeps = Readonly<{
  repo: InboxRepository
  staffPublicApi: StaffPublicApi
}>

export const getInboxItemDetail =
  (deps: GetInboxItemDetailDeps) =>
  async (input: GetInboxItemDetailInput): Promise<InboxItemDetail> => {
    if (!can(input.role, 'inbox.read')) {
      throw inboxError('forbidden', 'No inbox read permission')
    }
    const detail = await deps.repo.findDetailById(input.inboxItemId, input.organizationId)
    if (!detail) {
      throw inboxError('not_found', 'Inbox item not found', {
        inboxItemId: input.inboxItemId,
      })
    }

    await assertPropertyAccessible(
      deps.staffPublicApi,
      input.organizationId,
      input.userId,
      input.role,
      detail.item.propertyId,
    )

    return detail
  }

// fallow-ignore-next-line unused-type
export type GetInboxItemDetailUseCase = ReturnType<typeof getInboxItemDetail>
