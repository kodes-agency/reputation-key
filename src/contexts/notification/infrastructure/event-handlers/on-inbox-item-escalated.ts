// Notification context — event handler for inbox.inbox_item.escalated
// Notifies account admins when an inbox item is escalated.

import type { Queue } from 'bullmq'
import type { InboxItemEscalated } from '#/contexts/inbox/application/public-api'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'

type Deps = Readonly<{
  queue: Queue
  userLookup: UserLookupPort
  logger: LoggerPort
}>

export const onInboxItemEscalated =
  (deps: Deps) =>
  async (event: InboxItemEscalated): Promise<void> => {
    const recipients = await deps.userLookup.findByRole(
      event.organizationId,
      'AccountAdmin' as const,
    )

    if (recipients.length === 0) {
      deps.logger.warn(
        { organizationId: event.organizationId, eventId: event.eventId },
        'onInboxItemEscalated: no recipients found, skipping',
      )
      return
    }

    await Promise.all(
      recipients.map((userId) =>
        deps.queue.add(INSERT_NOTIFICATION_JOB_NAME, {
          userId,
          organizationId: event.organizationId,
          type: 'inbox.escalated' as const,
          resourceType: 'inbox_item' as const,
          resourceId: event.inboxItemId,
          eventId: event.eventId,
          title: 'Item escalated',
          body: 'An inbox item has been escalated',
        }),
      ),
    )
  }
