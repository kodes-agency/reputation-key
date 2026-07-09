import type {
  ActivityRepository,
  ActivityFilter,
  Pagination,
} from '../ports/activity-repository.port'
import type { ActivityLog } from '../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { PropertyId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { canForContext } from '#/shared/domain/permissions'

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
  async (
    input: GetOrgActivityInput,
    ctx: AuthContext,
  ): Promise<readonly ActivityLog[]> => {
    const pagination: Pagination = {
      limit: input.limit ?? 50,
      offset: input.offset ?? 0,
    }

    // Org-wide bypass mirrors the original action check (organization.update) — PM holds
    // it and sees the full feed; Staff (and assigned-scoped callers) are scoped.
    let entries: readonly ActivityLog[]
    if (canForContext(ctx, 'organization.update')) {
      const filter: ActivityFilter = input.propertyId
        ? { propertyId: input.propertyId }
        : {}
      entries = await deps.repo.findByOrganization(ctx.organizationId, filter, pagination)
    } else {
      const accessiblePropertyIds = await deps.staffPublicApi.getAccessiblePropertyIds(
        ctx.organizationId,
        ctx.userId,
        false,
      )

      if (accessiblePropertyIds !== null && accessiblePropertyIds.length > 0) {
        const filter: ActivityFilter = input.propertyId
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
    }

    // §9: strip reply-workflow rows for callers lacking reply.manage.
    return canForContext(ctx, 'reply.manage')
      ? entries
      : entries.filter((e) => e.resourceType !== 'reply')
  }
