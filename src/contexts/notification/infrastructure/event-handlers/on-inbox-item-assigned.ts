// Notification context — event handler for inbox.inbox_item.assigned
// Notifies the assignee that an inbox item was assigned to them.

import type { Queue } from 'bullmq'
import type { InboxItemAssigned } from '#/contexts/inbox/application/public-api'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'

type Deps = Readonly<{
  queue: Queue
}>

export const onInboxItemAssigned =
  (deps: Deps) =>
  async (event: InboxItemAssigned): Promise<void> => {
    const data = {
      userId: event.assignedTo,
      organizationId: event.organizationId,
      type: 'inbox.assigned' as const,
      resourceType: 'inbox_item' as const,
      resourceId: event.inboxItemId,
      eventId: event.eventId,
      title: 'Item assigned to you',
      body: 'An inbox item has been assigned to you',
    }

    await deps.queue.add(INSERT_NOTIFICATION_JOB_NAME, data)
  }
