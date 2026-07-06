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

    // F120: 'organization.update' bypasses property scoping for the resource
    // timeline, matching the org-wide activity query (getOrgActivity).
    let scoped: readonly ActivityLog[]
    if (can(input.role, 'organization.update')) {
      scoped = entries
    } else {
      // PM/Staff: scope to accessible properties
      const accessiblePropertyIds = await deps.staffPublicApi.getAccessiblePropertyIds(
        input.organizationId,
        input.userId,
        input.role,
      )
      scoped = filterByPropertyAccess(entries, accessiblePropertyIds)
    }

    // §9: strip reply-workflow rows for callers lacking reply.manage (Staff).
    // The reply lifecycle is PM+ only; inbox.read (held by Staff) must not
    // expose reply actions or rejection reasons via the resource timeline.
    return can(input.role, 'reply.manage')
      ? scoped
      : scoped.filter((e) => e.resourceType !== 'reply')
  }
