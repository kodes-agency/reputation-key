import type {
  ActivityRepository,
  ActivityFilter,
  Pagination,
} from '../ports/activity-repository.port'
import type { ActivityLog } from '../domain/types'
import type { Role } from '#/shared/domain/roles'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { can } from '#/shared/domain/permissions'
import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'

/** Filter entries to only those within the user's accessible properties.
 *  null accessiblePropertyIds = Admin → see everything.
 *  Used by get-activity-timeline.ts for resource-scoped queries that can't
 *  push the filter into SQL (the resource is the primary lookup key). */
export const filterByPropertyAccess = (
  entries: readonly ActivityLog[],
  accessiblePropertyIds: readonly PropertyId[] | null,
): readonly ActivityLog[] => {
  if (accessiblePropertyIds === null) return entries
  const allowed = new Set(accessiblePropertyIds.map((p) => p as string))
  return entries.filter(
    (entry) => entry.propertyId === null || allowed.has(entry.propertyId as string),
  )
}

type GetOrgActivityInput = Readonly<{
  organizationId: OrganizationId
  userId: UserId
  role: Role
  propertyId?: PropertyId
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
    const pagination: Pagination = {
      limit: input.limit ?? 50,
      offset: input.offset ?? 0,
    }

    // ACT-004: Use 'organization.update' (AccountAdmin-only) instead of
    // 'inbox.manage' (AccountAdmin + PropertyManager) — matching
    // get-activity-timeline.ts (F120). Only AccountAdmin bypasses property
    // scoping for the org-wide activity feed.
    let entries: readonly ActivityLog[]
    if (can(input.role, 'organization.update')) {
      const filter: ActivityFilter = input.propertyId
        ? { propertyId: input.propertyId }
        : {}
      entries = await deps.repo.findByOrganization(
        input.organizationId,
        filter,
        pagination,
      )
    } else {
      // PM/Staff: scope to accessible properties
      const accessiblePropertyIds = await deps.staffPublicApi.getAccessiblePropertyIds(
        input.organizationId,
        input.userId,
        input.role === 'AccountAdmin',
      )

      // ACT-010: push property-access scoping into SQL (propertyId IN accessible
      // OR propertyId IS NULL) instead of in-memory filter-then-slice. This
      // preserves correct pagination without an expanded-limit fetch.
      if (accessiblePropertyIds !== null && accessiblePropertyIds.length > 0) {
        const filter: ActivityFilter = input.propertyId
          ? { propertyId: input.propertyId }
          : { propertyIds: accessiblePropertyIds }
        entries = await deps.repo.findByOrganization(
          input.organizationId,
          filter,
          pagination,
        )
      } else {
        entries = []
      }
    }

    // §9: strip reply-workflow rows for callers lacking reply.manage (Staff).
    // Applied here (not just the route) so a direct RPC call also honours the
    // reply visibility rule. Admins/PMs hold reply.manage and are unaffected.
    return can(input.role, 'reply.manage')
      ? entries
      : entries.filter((e) => e.resourceType !== 'reply')
  }
