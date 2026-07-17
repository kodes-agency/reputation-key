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
      eventId: event.eventId,
      payload: {
        subject: 'note',
        from: null,
        to: null,
        // BQC-1.2 / ADR 0045 r.3-4: content-free — no note text; authorized
        // detail is fetched at view time via the inbox item.
        detail: null,
      },
    }
    await deps.queue.add('insert-activity-log', payload)
  }
