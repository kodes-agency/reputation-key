// Notification context — event handler for inbox.inbox_item.assigned
// Notifies the assignee that an inbox item was assigned to them.

import type { InboxItemAssigned } from '#/contexts/inbox/application/public-api'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import type { InboxItemLookupPort } from '../../application/ports/inbox-item-lookup.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'
import type { NotificationJobEnqueuePort } from '../inbox-notification-fanout'
import { buildInboxItemPayload } from './payload-facts'

type Deps = Readonly<{
  queue: NotificationJobEnqueuePort
  userLookup: UserLookupPort
  inboxItemLookup: InboxItemLookupPort
  clock: () => Date
  logger: LoggerPort
}>

export const onInboxItemAssigned =
  (deps: Deps) =>
  async (event: InboxItemAssigned): Promise<void> => {
    // `event.userId` is whoever performed the assignment; the template renders
    // their ROLE ("A property manager assigned this to you"), never their name.
    const payload = await buildInboxItemPayload(deps, {
      inboxItemId: event.inboxItemId,
      orgId: event.organizationId,
      actorId: event.userId,
    })

    const data = {
      userId: event.assignedTo,
      organizationId: event.organizationId,
      propertyId: event.propertyId,
      type: 'inbox.assigned' as const,
      resourceType: 'inbox_item' as const,
      resourceId: event.inboxItemId,
      eventId: event.eventId,
      payload,
      audience: {
        kind: 'inbox_assignee' as const,
        inboxItemId: event.inboxItemId,
      },
    }

    await deps.queue.add(INSERT_NOTIFICATION_JOB_NAME, data, {
      jobId: `${event.eventId}-${event.assignedTo}`,
    })
  }
