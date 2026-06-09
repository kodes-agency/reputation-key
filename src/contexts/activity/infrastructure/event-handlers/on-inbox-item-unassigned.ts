import type { InboxItemUnassigned } from '#/contexts/inbox/application/public-api'
import type { InsertActivityLogInput } from '../../application/use-cases/insert-activity-log'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue }

export const onInboxItemUnassigned =
  (deps: Deps) =>
  async (event: InboxItemUnassigned): Promise<void> => {
    const payload: InsertActivityLogInput = {
      action: 'unassigned' as const,
      resourceType: 'inbox_item' as const,
      resourceId: event.inboxItemId,
      propertyId: event.propertyId || null,
      organizationId: event.organizationId,
      userId: event.userId || null,
      source: event.source,
      payload: {
        subject: 'inbox_item',
        from: event.previousAssignee,
        to: null,
        detail: null,
      },
    }
    await deps.queue.add('insert-activity-log', payload)
  }
