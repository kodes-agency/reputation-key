import type {
  RecentActivityRepository,
  RecentActivityFilter,
  Pagination,
} from '../ports/recent-activity-repository.port'
import type { RecentActivityEntry } from '../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { PropertyId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { canForContext, scopeForPermission } from '#/shared/domain/permissions'

/** Filter entries to only those within the user's accessible properties.
 *  null accessiblePropertyIds = Admin → see everything.
 *  Used by get-activity-timeline.ts for resource-scoped queries that can't
 *  push the filter into SQL (the resource is the primary lookup key). */
export const filterByPropertyAccess = (
  entries: readonly RecentActivityEntry[],
  accessiblePropertyIds: readonly PropertyId[] | null,
): readonly RecentActivityEntry[] => {
  if (accessiblePropertyIds === null) return entries
  const allowed = new Set(accessiblePropertyIds.map((p) => p as string))
  return entries.filter(
    (entry) => entry.propertyId !== null && allowed.has(entry.propertyId as string),
  )
}

type ListRecentActivityInput = Readonly<{
  propertyId?: PropertyId
  limit?: number
  offset?: number
}>

type ListRecentActivityDeps = Readonly<{
  repo: RecentActivityRepository
  staffPublicApi: StaffPublicApi
}>

export const listRecentActivity =
  (deps: ListRecentActivityDeps) =>
  async (
    input: ListRecentActivityInput,
    ctx: AuthContext,
  ): Promise<readonly RecentActivityEntry[]> => {
    const pagination: Pagination = {
      limit: input.limit ?? 50,
      offset: input.offset ?? 0,
    }

    // Read scope is permission-specific. PropertyManager has an Organization
    // mutation permission but remains assigned-properties scoped for Inbox and
    // therefore Recent Activity data.
    let entries: readonly RecentActivityEntry[]
    const readScope = scopeForPermission(ctx, 'inbox.read')
    if (readScope === 'organization') {
      const filter: RecentActivityFilter = input.propertyId
        ? { propertyId: input.propertyId }
        : {}
      entries = await deps.repo.findByOrganization(ctx.organizationId, filter, pagination)
    } else if (readScope === 'assigned-properties') {
      const accessiblePropertyIds = await deps.staffPublicApi.getAccessiblePropertyIds(
        ctx.organizationId,
        ctx.userId,
        false,
      )

      const requestedPropertyAllowed =
        input.propertyId === undefined ||
        (accessiblePropertyIds !== null &&
          accessiblePropertyIds.some(
            (candidate) => (candidate as string) === (input.propertyId as string),
          ))
      if (
        accessiblePropertyIds !== null &&
        accessiblePropertyIds.length > 0 &&
        requestedPropertyAllowed
      ) {
        const filter: RecentActivityFilter = input.propertyId
          ? { propertyId: input.propertyId }
          : { propertyIds: accessiblePropertyIds }
        entries = await deps.repo.findByOrganization(
          ctx.organizationId,
          filter,
          pagination,
        )
      } else {
        entries = []
      }
    } else {
      entries = []
    }

    // §9: strip reply-workflow rows for callers lacking reply.manage.
    return canForContext(ctx, 'reply.manage')
      ? entries
      : entries.filter((e) => e.resourceType !== 'reply')
  }
