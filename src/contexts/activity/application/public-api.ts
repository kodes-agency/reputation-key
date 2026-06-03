import type { ActivityLog } from '../domain/types'
import type { Role } from '#/shared/domain/roles'

export type {
  ActivityLog,
  ActivityAction,
  ResourceType,
  ActivityPayload,
} from '../domain/types'

export type ActivityPublicApi = Readonly<{
  getActivityTimeline(input: {
    resourceType: string
    resourceId: string
    organizationId: string
    userId: string
    role: Role
    limit?: number
  }): Promise<readonly ActivityLog[]>
  getOrgActivity(input: {
    organizationId: string
    userId: string
    role: Role
    propertyId?: string
    limit?: number
    offset?: number
  }): Promise<readonly ActivityLog[]>
}>
