import type { ActivityRepository } from '../ports/activity-repository.port'
import type { ActivityLog } from '../domain/types'
import type { Role } from '#/shared/domain/roles'

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
}>

// TODO: Wire staffPublicApi for property-level permission filtering.
// Currently returns all activity for the given resource without checking
// whether the requesting user has access to the associated property.
export const getActivityTimeline =
  (deps: GetTimelineDeps) =>
  async (input: GetTimelineInput): Promise<readonly ActivityLog[]> => {
    const limit = input.limit ?? 50
    return deps.repo.findByResource(input.resourceType, input.resourceId, limit)
  }
