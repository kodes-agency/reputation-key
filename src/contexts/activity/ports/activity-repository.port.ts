import type { ActivityLog } from '../domain/types'
import type { ActivityAction, ResourceType, ActivityPayload } from '../domain/types'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

export type ActivityFilter = Readonly<{
  resourceType?: string
  resourceId?: string
  propertyId?: PropertyId
  /** When set (non-null array), restrict results to these properties plus
   *  system-level entries (propertyId IS NULL). Used by PM/Staff scoping. */
  propertyIds?: readonly PropertyId[]
}>

export type Pagination = Readonly<{ limit: number; offset: number }>

export type FindDuplicateInput = Readonly<{
  eventId: string
  action: ActivityAction
  resourceType: ResourceType
  resourceId: string
  organizationId: OrganizationId
  payload: ActivityPayload
}>

export type ActivityRepository = Readonly<{
  insert(entry: ActivityLog): Promise<void>
  findByResource(
    orgId: OrganizationId,
    resourceType: string,
    resourceId: string,
    limit: number,
  ): Promise<readonly ActivityLog[]>
  findByOrganization(
    orgId: OrganizationId,
    filter: ActivityFilter,
    pagination: Pagination,
  ): Promise<readonly ActivityLog[]>
  /** Check if a duplicate activity entry already exists (idempotency gate). */
  findDuplicate(input: FindDuplicateInput): Promise<boolean>
}>
