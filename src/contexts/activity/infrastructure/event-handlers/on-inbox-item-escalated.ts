import type { InboxItemEscalated } from '#/contexts/inbox/application/public-api'
import type { InsertActivityLogInput } from '../../application/use-cases/insert-activity-log'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue }

export const onInboxItemEscalated =
  (deps: Deps) =>
  async (event: InboxItemEscalated): Promise<void> => {
    // Escalation is a standalone flag action (ADR 0023) — no status transition,
    // so the payload carries the flag state, not oldStatus/newStatus.
    const payload: InsertActivityLogInput = {
      action: 'escalated' as const,
      resourceType: 'inbox_item' as const,
      resourceId: event.inboxItemId,
      propertyId: event.propertyId || null,
      organizationId: event.organizationId,
      userId: event.userId || null,
      source: event.source,
      eventId: event.eventId,
      payload: {
        subject: 'escalation',
        from: null,
        to: 'flagged',
        detail: null,
      },
    }
    await deps.queue.add('insert-activity-log', payload)
  }
