// Activity context — entity constructors

import type { ActivityLog, ActivityAction } from './types'
import { activityError } from './errors'

export type CreateActivityLogInput = Readonly<{
  actorId: string
  actorName: string
  actorAvatarUrl: string | null
  actorRole: ActivityLog['actorRole']
  action: ActivityAction
  resourceType: ActivityLog['resourceType']
  resourceId: string
  propertyId: string | null
  organizationId: string
  payload: ActivityLog['payload']
  source: ActivityLog['source']
}>

const ALLOWED_ACTIONS: ReadonlySet<ActivityAction> = new Set([
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
])

export const createActivityLog = (
  input: CreateActivityLogInput,
  clock: () => Date,
): ActivityLog => {
  if (!ALLOWED_ACTIONS.has(input.action)) {
    throw activityError('invalid_action', `Invalid action: ${input.action}`, {
      action: input.action,
    })
  }

  return {
    id: '', // populated by the database with uuid defaultRandom()
    actorId: input.actorId,
    actorName: input.actorName,
    actorAvatarUrl: input.actorAvatarUrl,
    actorRole: input.actorRole,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    propertyId: input.propertyId,
    organizationId: input.organizationId,
    payload: input.payload,
    source: input.source,
    createdAt: clock(),
  }
}
