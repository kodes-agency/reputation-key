import type {
  ActivityRepository,
  ActivityFilter,
  Pagination,
} from '../ports/activity-repository.port'
import type { ActivityLog } from '../domain/types'

type GetOrgActivityInput = Readonly<{
  organizationId: string
  propertyId?: string
  limit?: number
  offset?: number
}>

type GetOrgActivityDeps = Readonly<{
  repo: ActivityRepository
}>

export const getOrgActivity =
  (deps: GetOrgActivityDeps) =>
  async (input: GetOrgActivityInput): Promise<readonly ActivityLog[]> => {
    const filter: ActivityFilter = input.propertyId
      ? { propertyId: input.propertyId }
      : {}
    const pagination: Pagination = { limit: input.limit ?? 50, offset: input.offset ?? 0 }
    return deps.repo.findByOrganization(input.organizationId, filter, pagination)
  }
