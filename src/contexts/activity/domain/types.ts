// Activity context — domain types
// Per architecture: "Domain types use Readonly<> on every field."

import type { Role } from '#/shared/domain/roles'
import type {
  ActivityLogId,
  UserId,
  OrganizationId,
  PropertyId,
} from '#/shared/domain/ids'

export type ActivityAction =
  | 'created'
  | 'changed'
  | 'deleted'
  | 'assigned'
  | 'unassigned'
  | 'published'
  | 'rejected'
  | 'approved'
  | 'submitted'
  | 'added'
  | 'escalated'
  | 'invited'
  | 'connected'
  | 'disconnected'

export type ResourceType =
  | 'inbox_item'
  | 'review'
  | 'reply'
  | 'note'
  | 'property'
  | 'member'
  | 'team'
  | 'staff_assignment'
  | 'integration'

export type ActivityPayload = Readonly<{
  subject: string
  from: string | null
  to: string | null
  detail: string | null
  bulkId?: string
}>

export type ActivityLog = Readonly<{
  id: ActivityLogId
  actorId: UserId
  actorName: string
  actorAvatarUrl: string | null
  actorRole: Role
  action: ActivityAction
  resourceType: ResourceType
  resourceId: string
  propertyId: PropertyId | null
  organizationId: OrganizationId
  payload: ActivityPayload
  source: 'web' | 'import'
  eventId: string | null
  createdAt: Date
}>
