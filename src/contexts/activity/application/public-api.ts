import type { ActivityLog } from '../domain/types'
import type { Role } from '#/shared/domain/roles'
import type { OrganizationId, UserId, PropertyId } from '#/shared/domain/ids'

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
    organizationId: OrganizationId
    userId: UserId
    role: Role
    limit?: number
  }): Promise<readonly ActivityLog[]>
  getOrgActivity(input: {
    organizationId: OrganizationId
    userId: UserId
    role: Role
    propertyId?: PropertyId
    limit?: number
    offset?: number
  }): Promise<readonly ActivityLog[]>
}>
