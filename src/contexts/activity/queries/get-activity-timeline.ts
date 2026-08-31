import type { RecentActivityRepository } from '../ports/recent-activity-repository.port'
import type { RecentActivityEntry } from '../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { canForContext, scopeForPermission } from '#/shared/domain/permissions'
import { filterByPropertyAccess } from './list-recent-activity'
import type { ResourceType } from '../domain/types'

type GetTimelineInput = Readonly<{
  resourceType: ResourceType
  resourceId: string
  limit?: number
}>

type GetTimelineDeps = Readonly<{
  repo: RecentActivityRepository
  staffPublicApi: StaffPublicApi
}>

export const getActivityTimeline =
  (deps: GetTimelineDeps) =>
  async (
    input: GetTimelineInput,
    ctx: AuthContext,
  ): Promise<readonly RecentActivityEntry[]> => {
    const limit = input.limit ?? 50
    const entries = await deps.repo.findByResource(
      ctx.organizationId,
      input.resourceType,
      input.resourceId,
      limit,
    )

    // Data scope, not an unrelated Organization mutation permission, decides
    // whether this read is tenant-wide. PropertyManager intentionally has
    // organization.update but only assigned-properties scope for Inbox data.
    let scoped: readonly RecentActivityEntry[]
    const readScope = scopeForPermission(ctx, 'inbox.read')
    if (readScope === 'organization') {
      scoped = entries
    } else if (readScope === 'assigned-properties') {
      const accessiblePropertyIds = await deps.staffPublicApi.getAccessiblePropertyIds(
        ctx.organizationId,
        ctx.userId,
        false,
      )
      scoped =
        accessiblePropertyIds === null
          ? []
          : filterByPropertyAccess(entries, accessiblePropertyIds)
    } else {
      scoped = []
    }

    // §9: strip reply-workflow rows for callers lacking reply.manage.
    return canForContext(ctx, 'reply.manage')
      ? scoped
      : scoped.filter((e) => e.resourceType !== 'reply')
  }
