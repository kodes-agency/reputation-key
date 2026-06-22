import type { InboxItemBulkStatusChanged } from '#/contexts/inbox/application/public-api'
import type { InsertActivityLogInput } from '../../application/use-cases/insert-activity-log'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue }

export const onInboxBulkStatusChanged =
  (deps: Deps) =>
  async (event: InboxItemBulkStatusChanged): Promise<void> => {
    const payload: InsertActivityLogInput = {
      action: 'changed' as const,
      resourceType: 'inbox_item' as const,
      resourceId: event.inboxItemId,
      propertyId: event.propertyId || null,
      organizationId: event.organizationId,
      userId: event.userId || null,
      source: event.source,
      eventId: event.eventId,
      payload: {
        subject: 'status',
        from: event.oldStatus,
        to: event.newStatus,
        detail: null,
        bulkId: event.bulkId,
      },
    }
    await deps.queue.add('insert-activity-log', payload)
  }
