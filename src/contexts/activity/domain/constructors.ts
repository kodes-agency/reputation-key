// Activity context — entity constructors
// Per architecture: "Domain Returns Result<T, DomainError>. Never throws."

import { ok, err, type Result } from 'neverthrow'
import type { ActivityLog, ActivityAction } from './types'
import { activityError, type ActivityError } from './errors'

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

// Validators sync with the ActivityAction type union — if you add to the type,
// add to this set. There's a test enforcing this invariant.
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
): Result<ActivityLog, ActivityError> => {
  if (!ALLOWED_ACTIONS.has(input.action)) {
    return err(
      activityError('invalid_action', `Invalid action: ${input.action}`, {
        action: input.action,
      }),
    )
  }

  return ok({
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
  })
}
