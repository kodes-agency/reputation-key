import type {
  ActivityRepository,
  ActivityFilter,
  Pagination,
} from '../ports/activity-repository.port'
import type { ActivityLog } from '../domain/types'
import type { Role } from '#/shared/domain/roles'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { can } from '#/shared/domain/permissions'
import { organizationId, userId as toUserId } from '#/shared/domain/ids'

type GetOrgActivityInput = Readonly<{
  organizationId: string
  userId: string
  role: Role
  propertyId?: string
  limit?: number
  offset?: number
}>

type GetOrgActivityDeps = Readonly<{
  repo: ActivityRepository
  staffPublicApi: StaffPublicApi
}>

export const getOrgActivity =
  (deps: GetOrgActivityDeps) =>
  async (input: GetOrgActivityInput): Promise<readonly ActivityLog[]> => {
    const filter: ActivityFilter = input.propertyId
      ? { propertyId: input.propertyId }
      : {}
    const pagination: Pagination = {
      limit: input.limit ?? 50,
      offset: input.offset ?? 0,
    }

    // Admins see all org activity
    if (can(input.role, 'inbox.manage')) {
      return deps.repo.findByOrganization(input.organizationId, filter, pagination)
    }

    // PM/Staff: scope to accessible properties
    const accessiblePropertyIds = await deps.staffPublicApi.getAccessiblePropertyIds(
      organizationId(input.organizationId),
      toUserId(input.userId),
      input.role,
    )

    if (accessiblePropertyIds !== null && accessiblePropertyIds.length > 0) {
      const entries = await deps.repo.findByOrganization(input.organizationId, filter, {
        limit: 200,
        offset: 0,
      })
      const allowed = new Set(accessiblePropertyIds.map((p) => p as string))
      return entries.filter(
        (entry) => entry.propertyId === null || allowed.has(entry.propertyId),
      )
    }

    return []
  }
