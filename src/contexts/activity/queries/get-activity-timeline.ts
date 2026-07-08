import type { ActivityRepository } from '../ports/activity-repository.port'
import type { ActivityLog } from '../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { canForContext } from '#/shared/domain/permissions'
import { filterByPropertyAccess } from './get-org-activity'

type GetTimelineInput = Readonly<{
  resourceType: string
  resourceId: string
  limit?: number
}>

type GetTimelineDeps = Readonly<{
  repo: ActivityRepository
  staffPublicApi: StaffPublicApi
}>

export const getActivityTimeline =
  (deps: GetTimelineDeps) =>
  async (input: GetTimelineInput, ctx: AuthContext): Promise<readonly ActivityLog[]> => {
    const limit = input.limit ?? 50
    const entries = await deps.repo.findByResource(
      ctx.organizationId,
      input.resourceType,
      input.resourceId,
      limit,
    )

    // Org-wide bypass mirrors the original action check (organization.update) — PM holds
    // it and sees the full timeline; Staff are scoped to assigned properties.
    let scoped: readonly ActivityLog[]
    if (canForContext(ctx, 'organization.update')) {
      scoped = entries
    } else {
      const accessiblePropertyIds = await deps.staffPublicApi.getAccessiblePropertyIds(
        ctx.organizationId,
        ctx.userId,
        false,
      )
      scoped = filterByPropertyAccess(entries, accessiblePropertyIds)
    }

    // §9: strip reply-workflow rows for callers lacking reply.manage.
    return canForContext(ctx, 'reply.manage')
      ? scoped
      : scoped.filter((e) => e.resourceType !== 'reply')
  }
