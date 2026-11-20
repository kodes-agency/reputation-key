import type { RecentActivityEntry } from '../domain/activity-types'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

export type RecentActivityFilter = Readonly<{
  resourceType?: string
  resourceId?: string
  propertyId?: PropertyId
  /** When set (non-null array), restrict results to these properties plus
   *  system-level entries (propertyId IS NULL). Used by PM/Staff scoping. */
  propertyIds?: readonly PropertyId[]
}>

export type Pagination = Readonly<{ limit: number; offset: number }>

export type RecentActivityRepository = Readonly<{
  findByResource(
    orgId: OrganizationId,
    resourceType: string,
    resourceId: string,
    limit: number,
  ): Promise<readonly RecentActivityEntry[]>
  findByOrganization(
    orgId: OrganizationId,
    filter: RecentActivityFilter,
    pagination: Pagination,
  ): Promise<readonly RecentActivityEntry[]>
}>
