import type { InboxItemEscalated } from '#/contexts/inbox/domain/events'
import type { InsertActivityLogInput } from '../../application/use-cases/insert-activity-log'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue }

export const onInboxItemEscalated =
  (deps: Deps) =>
  async (event: InboxItemEscalated): Promise<void> => {
    const payload: InsertActivityLogInput = {
      action: 'escalated' as const,
      resourceType: 'inbox_item' as const,
      resourceId: event.inboxItemId,
      propertyId: event.propertyId || null,
      organizationId: event.organizationId,
      userId: event.userId || null,
      source: event.source,
      payload: {
        subject: 'inbox_item',
        from: event.oldStatus,
        to: 'escalated',
        detail: null,
      },
    }
    await deps.queue.add('insert-activity-log', payload)
  }
