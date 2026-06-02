// Activity context — event handler registration
// Subscribes to domain events from other contexts and records them in the activity log.
// Per architecture: "Handlers are idempotent, don't throw, log via shared logger."

import type { EventBus } from '#/shared/events/event-bus'
import type { ActivityRepository } from '../../ports/activity-repository.port'
import type { UserLookupPort } from '../../ports/user-lookup.port'
import type { DomainEvent } from '#/shared/events/events'
import type { Role } from '#/shared/domain/roles'
import { eventToActivity } from '../../application/event-to-activity'
import { createActivityLog } from '../../domain/constructors'
import type { LoggerPort } from '#/shared/domain/logger.port'

export type RegisterActivityHandlersDeps = Readonly<{
  events: EventBus
  repo: ActivityRepository
  userLookup: UserLookupPort
  clock: () => Date
  logger: LoggerPort
}>

const handleActivityEvent =
  (deps: {
    repo: ActivityRepository
    userLookup: UserLookupPort
    clock: () => Date
    logger: LoggerPort
  }) =>
  async (event: DomainEvent): Promise<void> => {
    const mapped = eventToActivity(event)
    if (!mapped) return

    // Idempotency check: skip if an identical entry already exists.
    // Activity log is append-only with at-least-once event delivery, so
    // event replay must not produce duplicates.
    const duplicate = await deps.repo.findDuplicate(mapped)
    if (duplicate) return

    // Best-effort user lookup — don't block if lookup fails
    let userInfo: { name: string; avatarUrl: string | null; role: Role } = {
      name: 'System',
      avatarUrl: null,
      role: 'Staff',
    }
    try {
      const userId = extractUserId(event)
      if (userId) {
        userInfo = await deps.userLookup.lookup(userId, mapped.organizationId)
      }
    } catch {
      // Fall through to default
    }

    const result = createActivityLog(
      {
        actorId: extractUserId(event) ?? 'system',
        actorName: userInfo.name,
        actorAvatarUrl: userInfo.avatarUrl,
        actorRole: userInfo.role,
        action: mapped.action,
        resourceType: mapped.resourceType,
        resourceId: mapped.resourceId,
        propertyId: mapped.propertyId,
        organizationId: mapped.organizationId,
        payload: mapped.payload,
        source: 'system',
      },
      deps.clock,
    )

    if (result.isErr()) {
      deps.logger.warn(
        { err: result.error, event: event._tag },
        'Activity log constructor rejected event',
      )
      return
    }

    const entry = result.value
    await deps.repo.insert(entry)
  }

// Helper to extract userId from various event shapes
function extractUserId(event: DomainEvent): string | null {
  if ('authorUserId' in event && typeof event.authorUserId === 'string')
    return event.authorUserId
  if ('userId' in event && typeof event.userId === 'string') return event.userId
  if ('assignedTo' in event && typeof event.assignedTo === 'string')
    return event.assignedTo
  return null
}

export const registerActivityHandlers = (deps: RegisterActivityHandlersDeps): void => {
  const handler = handleActivityEvent(deps)

  const EVENT_TAGS = [
    'inbox.item.created',
    'inbox.status.changed',
    'inbox.item.escalated',
    'inbox.item.assigned',
    'inbox.item.unassigned',
    'inbox.note.added',
    'inbox.bulk.status.changed',
    'reply.published',
    'reply.submitted',
    'reply.approved',
    'reply.rejected',
  ] as const

  for (const tag of EVENT_TAGS) {
    deps.events.on(tag, handler as never)
  }
}
