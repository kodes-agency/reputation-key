// Inbox context — get inbox item detail use case
// Returns full detail view (item + source data) for a single inbox item.
// Enforces role-scoped property access.

import type { InboxRepository } from '../ports/inbox.repository'
import type { InboxItemId, OrganizationId, UserId } from '#/shared/domain/ids'
import type { InboxItemDetail } from '../../domain/types'
import type { Role } from '#/shared/domain/roles'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { hasRole } from '#/shared/domain/roles'
import { inboxError } from '../../domain/errors'

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
    const detail = await deps.repo.findDetailById(input.inboxItemId, input.organizationId)
    if (!detail) {
      throw inboxError('not_found', 'Inbox item not found', {
        inboxItemId: input.inboxItemId,
      })
    }

    if (!hasRole(input.role, 'AccountAdmin' as Role)) {
      const accessible = await deps.staffPublicApi.getAccessiblePropertyIds(
        input.organizationId,
        input.userId,
        input.role,
      )
      if (
        accessible !== null &&
        !accessible.includes(
          detail.item.propertyId as ReturnType<
            typeof import('#/shared/domain/ids').propertyId
          >,
        )
      ) {
        throw inboxError('forbidden', 'No access to this property', {
          propertyId: detail.item.propertyId,
        })
      }
    }

    return detail
  }

// fallow-ignore-next-line unused-type
export type GetInboxItemDetailUseCase = ReturnType<typeof getInboxItemDetail>
