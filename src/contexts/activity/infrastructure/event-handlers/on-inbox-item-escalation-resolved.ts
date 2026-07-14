import type { InboxItemEscalationResolved } from '#/contexts/inbox/application/public-api'
import type { InsertActivityLogInput } from '../../application/use-cases/insert-activity-log'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue }

export const onInboxItemEscalationResolved =
  (deps: Deps) =>
  async (event: InboxItemEscalationResolved): Promise<void> => {
    const payload: InsertActivityLogInput = {
      action: 'deescalated' as const,
      resourceType: 'inbox_item' as const,
      resourceId: event.inboxItemId,
      propertyId: event.propertyId || null,
      organizationId: event.organizationId,
      userId: event.userId || null,
      source: event.source,
      eventId: event.eventId,
      payload: {
        subject: 'escalation',
        from: 'flagged',
        to: 'resolved',
        detail: null,
      },
    }
    await deps.queue.add('insert-activity-log', payload)
  }
