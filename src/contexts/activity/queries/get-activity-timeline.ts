import type { ActivityRepository } from '../ports/activity-repository.port'
import type { ActivityLog } from '../domain/types'
import type { Role } from '#/shared/domain/roles'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { OrganizationId, UserId } from '#/shared/domain/ids'
import { can } from '#/shared/domain/permissions'
import { filterByPropertyAccess } from './get-org-activity'

type GetTimelineInput = Readonly<{
  resourceType: string
  resourceId: string
  organizationId: OrganizationId
  userId: UserId
  role: Role
  limit?: number
}>

type GetTimelineDeps = Readonly<{
  repo: ActivityRepository
  staffPublicApi: StaffPublicApi
}>

export const getActivityTimeline =
  (deps: GetTimelineDeps) =>
  async (input: GetTimelineInput): Promise<readonly ActivityLog[]> => {
    const limit = input.limit ?? 50
    const entries = await deps.repo.findByResource(
      input.organizationId,
      input.resourceType,
      input.resourceId,
      limit,
    )

    // Admins see everything
    // F120: Use 'organization.update' (AccountAdmin-only) instead of 'inbox.manage'
    // (AccountAdmin + PropertyManager) — activity timeline should only bypass
    // property scoping for AccountAdmin, matching the org-wide activity query.
    if (can(input.role, 'organization.update')) return entries

    // PM/Staff: scope to accessible properties
    const accessiblePropertyIds = await deps.staffPublicApi.getAccessiblePropertyIds(
      input.organizationId,
      input.userId,
      input.role,
    )

    return filterByPropertyAccess(entries, accessiblePropertyIds)
  }
