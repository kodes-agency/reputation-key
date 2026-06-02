import type { ActivityLog } from '../domain/types'
import type { MappedActivity } from '../application/event-to-activity'

export type ActivityFilter = Readonly<{
  resourceType?: string
  resourceId?: string
  propertyId?: string
}>

export type Pagination = Readonly<{ limit: number; offset: number }>

export type ActivityRepository = Readonly<{
  insert(entry: Omit<ActivityLog, 'id' | 'createdAt'>): Promise<void>
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
  findDuplicate(mapped: MappedActivity): Promise<boolean>
}>
