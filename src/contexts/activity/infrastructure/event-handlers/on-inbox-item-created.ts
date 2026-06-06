import type { InboxItemCreated } from '#/contexts/inbox/domain/events'
import type { InsertActivityLogInput } from '../../application/use-cases/insert-activity-log'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue }

export const onInboxItemCreated =
  (deps: Deps) =>
  async (event: InboxItemCreated): Promise<void> => {
    const payload: InsertActivityLogInput = {
      action: 'created' as const,
      resourceType: 'inbox_item' as const,
      resourceId: event.inboxItemId,
      propertyId: event.propertyId || null,
      organizationId: event.organizationId,
      userId: event.userId || null,
      source: event.source,
      payload: {
        subject: 'inbox_item',
        from: null,
        to: null,
        detail: event.sourceType,
      },
    }
    await deps.queue.add('insert-activity-log', payload)
  }
