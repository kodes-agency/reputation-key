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

// Validators sync with the ActivityAction/ResourceType/source type unions —
// if you add to a type, add to the corresponding set.
// There's a test enforcing the action invariant.
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

const ALLOWED_RESOURCE_TYPES: ReadonlySet<ActivityLog['resourceType']> = new Set([
  'inbox_item',
  'review',
  'reply',
  'note',
  'property',
  'member',
])

const ALLOWED_SOURCES: ReadonlySet<ActivityLog['source']> = new Set(['web', 'import'])

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

  if (!ALLOWED_RESOURCE_TYPES.has(input.resourceType)) {
    return err(
      activityError(
        'invalid_resource_type',
        `Invalid resourceType: ${input.resourceType}`,
        {
          resourceType: input.resourceType,
        },
      ),
    )
  }

  if (!ALLOWED_SOURCES.has(input.source)) {
    return err(
      activityError('invalid_source', `Invalid source: ${input.source}`, {
        source: input.source,
      }),
    )
  }

  return ok({
    id: '', // placeholder — overwritten by use case with idGen(); DB defaultRandom() is fallback
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
