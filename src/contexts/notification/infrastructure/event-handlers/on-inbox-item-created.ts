// Notification context — event handler for inbox.inbox_item.created (feedback source)
// Notifies property managers about new feedback submissions.

import type { Queue } from 'bullmq'
import type { InboxItemCreated } from '#/contexts/inbox/application/public-api'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'

type Deps = Readonly<{
  queue: Queue
  userLookup: UserLookupPort
}>

export const onInboxItemCreated =
  (deps: Deps) =>
  async (event: InboxItemCreated): Promise<void> => {
    if (event.sourceType !== 'feedback') return

    const recipients = await deps.userLookup.findAssignedManagers(event.propertyId)

    await Promise.all(
      recipients.map((userId) =>
        deps.queue.add(INSERT_NOTIFICATION_JOB_NAME, {
          userId,
          organizationId: event.organizationId,
          type: 'feedback.created' as const,
          resourceType: 'inbox_item' as const,
          resourceId: event.inboxItemId,
          eventId: event.eventId,
          title: 'New feedback',
          body: 'A guest submitted feedback',
        }),
      ),
    )
  }
