import type {
  ActivityRepository,
  ActivityFilter,
  Pagination,
} from '../ports/activity-repository.port'
import type { ActivityLog } from '../domain/types'
import type { Role } from '#/shared/domain/roles'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { can } from '#/shared/domain/permissions'
import type { PropertyId } from '#/shared/domain/ids'
import { organizationId, userId as toUserId } from '#/shared/domain/ids'

/** Filter entries to only those within the user's accessible properties.
 *  null accessiblePropertyIds = Admin → see everything. */
export const filterByPropertyAccess = (
  entries: readonly ActivityLog[],
  accessiblePropertyIds: readonly PropertyId[] | null,
): readonly ActivityLog[] => {
  if (accessiblePropertyIds === null) return entries
  const allowed = new Set(accessiblePropertyIds.map((p) => p as string))
  return entries.filter(
    (entry) => entry.propertyId === null || allowed.has(entry.propertyId),
  )
}

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
      // Fetch with expanded limit to cover filtering, then apply pagination
      const expandedLimit = pagination.offset + pagination.limit
      const entries = await deps.repo.findByOrganization(input.organizationId, filter, {
        limit: expandedLimit,
        offset: 0,
      })
      const filtered = filterByPropertyAccess(entries, accessiblePropertyIds)
      return filtered.slice(pagination.offset, pagination.offset + pagination.limit)
    }

    return []
  }
