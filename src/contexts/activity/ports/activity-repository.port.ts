import type { ActivityLog } from '../domain/types'
import type { ActivityAction, ResourceType, ActivityPayload } from '../domain/types'

export type ActivityFilter = Readonly<{
  resourceType?: string
  resourceId?: string
  propertyId?: string
}>

export type Pagination = Readonly<{ limit: number; offset: number }>

export type FindDuplicateInput = Readonly<{
  action: ActivityAction
  resourceType: ResourceType
  resourceId: string
  organizationId: string
  payload: ActivityPayload
}>

export type ActivityRepository = Readonly<{
  insert(entry: ActivityLog): Promise<void>
  findByResource(
    resourceType: string,
    resourceId: string,
    limit: number,
  ): Promise<readonly ActivityLog[]>
  findByOrganization(
    orgId: string,
    filter: ActivityFilter,
    pagination: Pagination,
  ): Promise<readonly ActivityLog[]>
  /** Check if a duplicate activity entry already exists (idempotency gate). */
  findDuplicate(input: FindDuplicateInput): Promise<boolean>
}>
