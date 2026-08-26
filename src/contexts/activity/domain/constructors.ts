// Activity context — entity constructors
// Per architecture: "Domain Returns Result<T, DomainError>. Never throws."

import { ok, err, type Result } from '#/shared/domain'
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_RESOURCE_TYPES,
  ACTIVITY_SOURCES,
  RECENT_ACTIVITY_KINDS,
  type RecentActivityEntry,
  type ActivityAction,
} from './types'
import type {
  ActivityLogId,
  UserId,
  OrganizationId,
  PropertyId,
} from '#/shared/domain/ids'
import { userId } from '#/shared/domain/ids'
import { activityError, type ActivityError } from './errors'

/** System user ID for automated / background operations. */
export const SYSTEM_USER_ID: UserId = userId('system')

export type CreateRecentActivityEntryInput = Readonly<{
  id: ActivityLogId
  actorId: UserId
  actorName: string
  actorAvatarUrl: string | null
  actorRole: RecentActivityEntry['actorRole']
  action: ActivityAction
  resourceType: RecentActivityEntry['resourceType']
  resourceId: string
  propertyId: PropertyId | null
  organizationId: OrganizationId
  payload: RecentActivityEntry['payload']
  source: RecentActivityEntry['source']
  eventId: string
}>

const ALLOWED_ACTIONS: ReadonlySet<ActivityAction> = new Set(ACTIVITY_ACTIONS)
const ALLOWED_RESOURCE_TYPES: ReadonlySet<RecentActivityEntry['resourceType']> = new Set(
  ACTIVITY_RESOURCE_TYPES,
)
const ALLOWED_SOURCES: ReadonlySet<RecentActivityEntry['source']> = new Set(
  ACTIVITY_SOURCES,
)
const ALLOWED_RECENT_ACTIVITY_KINDS: ReadonlySet<string> = new Set(
  RECENT_ACTIVITY_KINDS.map(
    ({ action, resourceType }) => `${action}\u0000${resourceType}`,
  ),
)

export const createRecentActivityEntry = (
  input: CreateRecentActivityEntryInput,
  clock: () => Date,
): Result<RecentActivityEntry, ActivityError> => {
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

  if (!ALLOWED_RECENT_ACTIVITY_KINDS.has(`${input.action}\u0000${input.resourceType}`)) {
    return err(
      activityError(
        'invalid_event_kind',
        `Unsupported Recent Activity kind: ${input.action}/${input.resourceType}`,
        { action: input.action, resourceType: input.resourceType },
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
    id: input.id,
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
    eventId: input.eventId,
    createdAt: clock(),
  })
}
