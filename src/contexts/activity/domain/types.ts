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

/**
 * Exact combinations the current Recent Activity projection is allowed to
 * create. The wider action/resource unions above remain read-compatible with
 * historical rows while new projections stay bounded to active event handlers.
 */
export const RECENT_ACTIVITY_KINDS = [
  { action: 'created', resourceType: 'inbox_item' },
  { action: 'changed', resourceType: 'inbox_item' },
  { action: 'assigned', resourceType: 'inbox_item' },
  { action: 'unassigned', resourceType: 'inbox_item' },
  { action: 'escalated', resourceType: 'inbox_item' },
  { action: 'deescalated', resourceType: 'inbox_item' },
  { action: 'added', resourceType: 'inbox_item' },
  { action: 'submitted', resourceType: 'reply' },
  { action: 'approved', resourceType: 'reply' },
  { action: 'rejected', resourceType: 'reply' },
  { action: 'published', resourceType: 'reply' },
  { action: 'changed', resourceType: 'reply' },
  { action: 'created', resourceType: 'property' },
  { action: 'changed', resourceType: 'property' },
  { action: 'deleted', resourceType: 'property' },
  { action: 'invited', resourceType: 'member' },
  { action: 'added', resourceType: 'member' },
  { action: 'deleted', resourceType: 'member' },
  { action: 'changed', resourceType: 'member' },
  { action: 'connected', resourceType: 'integration' },
  { action: 'disconnected', resourceType: 'integration' },
  { action: 'changed', resourceType: 'integration' },
  { action: 'created', resourceType: 'organization' },
] as const satisfies readonly Readonly<{
  action: ActivityAction
  resourceType: ResourceType
}>[]

export type RecentActivityKind = (typeof RECENT_ACTIVITY_KINDS)[number]

export const ACTIVITY_SOURCES = ['web', 'import'] as const

export type ActivitySource = (typeof ACTIVITY_SOURCES)[number]

export type ActivityPayload = Readonly<{
  subject: string
  from: string | null
  to: string | null
  detail: string | null
  bulkId?: string
}>

export type RecentActivityEntry = Readonly<{
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

/** @deprecated Use RecentActivityEntry; retained during the compatibility window. */
export type ActivityLog = RecentActivityEntry
