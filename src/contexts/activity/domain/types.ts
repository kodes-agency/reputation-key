// Activity context — domain types
// Per architecture: "Domain types use Readonly<> on every field."

import type { Role } from '#/shared/domain/roles'

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

export type ResourceType =
  | 'inbox_item'
  | 'review'
  | 'reply'
  | 'note'
  | 'property'
  | 'member'

export type ActivityPayload = Readonly<{
  subject: string
  from: string | null
  to: string | null
  detail: string | null
  bulkId?: string
}>

export type ActivityLog = Readonly<{
  id: string
  actorId: string
  actorName: string
  actorAvatarUrl: string | null
  actorRole: Role
  action: ActivityAction
  resourceType: ResourceType
  resourceId: string
  propertyId: string | null
  organizationId: string
  payload: ActivityPayload
  source: 'web' | 'import'
  createdAt: Date
}>
