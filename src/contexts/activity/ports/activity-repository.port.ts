import type { ActivityLog } from '../domain/types'

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
}>
