import type { InboxItemAssigned } from '#/contexts/inbox/application/public-api'
import type { InsertActivityLogInput } from '../../application/use-cases/insert-activity-log'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue }

export const onInboxItemAssigned =
  (deps: Deps) =>
  async (event: InboxItemAssigned): Promise<void> => {
    const payload: InsertActivityLogInput = {
      action: 'assigned' as const,
      resourceType: 'inbox_item' as const,
      resourceId: event.inboxItemId,
      propertyId: event.propertyId || null,
      organizationId: event.organizationId,
      userId: event.userId || null,
      source: event.source,
      payload: {
        subject: 'inbox_item',
        from: null,
        to: event.assignedTo,
        detail: null,
      },
    }
    await deps.queue.add('insert-activity-log', payload)
  }
