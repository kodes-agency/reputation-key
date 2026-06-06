import type { ActivityRepository } from '../ports/activity-repository.port'
import type { ActivityLog } from '../domain/types'
import type { Role } from '#/shared/domain/roles'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { can } from '#/shared/domain/permissions'
import { organizationId, userId as toUserId } from '#/shared/domain/ids'
import { filterByPropertyAccess } from './get-org-activity'

type GetTimelineInput = Readonly<{
  resourceType: string
  resourceId: string
  organizationId: string
  userId: string
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
      input.resourceType,
      input.resourceId,
      limit,
    )

    // Admins see everything
    if (can(input.role, 'inbox.manage')) return entries

    // PM/Staff: scope to accessible properties
    const accessiblePropertyIds = await deps.staffPublicApi.getAccessiblePropertyIds(
      organizationId(input.organizationId),
      toUserId(input.userId),
      input.role,
    )

    return filterByPropertyAccess(entries, accessiblePropertyIds)
  }
