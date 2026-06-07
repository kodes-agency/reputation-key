import type { InboxNoteAdded } from '#/contexts/inbox/application/public-api'
import type { InsertActivityLogInput } from '../../application/use-cases/insert-activity-log'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue }

export const onInboxNoteAdded =
  (deps: Deps) =>
  async (event: InboxNoteAdded): Promise<void> => {
    const payload: InsertActivityLogInput = {
      action: 'added' as const,
      resourceType: 'inbox_item' as const,
      resourceId: event.inboxItemId,
      propertyId: event.propertyId || null,
      organizationId: event.organizationId,
      userId: event.userId || null,
      source: event.source,
      payload: {
        subject: 'note',
        from: null,
        to: null,
        detail: event.text.length > 100 ? event.text.slice(0, 100) + '...' : event.text,
      },
    }
    await deps.queue.add('insert-activity-log', payload)
  }
