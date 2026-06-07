import type { InboxItemStatusChanged } from '#/contexts/inbox/application/public-api'
import type { InsertActivityLogInput } from '../../application/use-cases/insert-activity-log'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue }

export const onInboxStatusChanged =
  (deps: Deps) =>
  async (event: InboxItemStatusChanged): Promise<void> => {
    const payload: InsertActivityLogInput = {
      action: 'changed' as const,
      resourceType: 'inbox_item' as const,
      resourceId: event.inboxItemId,
      propertyId: event.propertyId || null,
      organizationId: event.organizationId,
      userId: event.userId || null,
      source: event.source,
      payload: {
        subject: 'status',
        from: event.oldStatus,
        to: event.newStatus,
        detail: null,
      },
    }
    console.log('[activity] enqueue insert-activity-log job', {
      resourceId: event.inboxItemId,
      from: event.oldStatus,
      to: event.newStatus,
    })
    await deps.queue.add('insert-activity-log', payload)
  }
