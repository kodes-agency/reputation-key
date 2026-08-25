// Activity context — domain types
// Per architecture: "Domain types use Readonly<> on every field."

import type { Role } from '#/shared/domain/roles'
import type {
  ActivityLogId,
  UserId,
  OrganizationId,
  PropertyId,
} from '#/shared/domain/ids'

/** Runtime authorities also used to derive the domain unions. */
export const ACTIVITY_ACTIONS = [
  'created',
  'changed',
  'deleted',
  'assigned',
  'unassigned',
  'published',
  'rejected',
  'approved',
  'submitted',
  'added',
  'escalated',
  'deescalated',
  'invited',
  'connected',
  'disconnected',
] as const

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number]

export const ACTIVITY_RESOURCE_TYPES = [
  'inbox_item',
  'review',
  'reply',
  'note',
  'property',
  'member',
  'team',
  'staff_assignment',
  'integration',
  'organization',
] as const

export type ResourceType = (typeof ACTIVITY_RESOURCE_TYPES)[number]

export const ACTIVITY_SOURCES = ['web', 'import'] as const

export type ActivitySource = (typeof ACTIVITY_SOURCES)[number]

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
  source: ActivitySource
  eventId: string | null
  createdAt: Date
}>
