import type { ReviewReplyPublicationCancelled } from '#/contexts/review/application/public-api'
import type { InsertActivityLogInput } from '../../application/use-cases/insert-activity-log'
import type { InboxItemLookupPort } from '../../ports/inbox-item-lookup.port'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue; inboxItemLookup: InboxItemLookupPort }

// BQC-3.8: audit trail for publication cancellations (disconnect/policy).
// Mirrors on-reply-published: scoped to reviews with an inbox item; the
// payload is identifier-only (the cause is an enum, never content).
export const onReplyPublicationCancelled =
  (deps: Deps) =>
  async (event: ReviewReplyPublicationCancelled): Promise<void> => {
    const inboxItemId = await deps.inboxItemLookup.findBySourceId(
      event.reviewId,
      event.organizationId,
    )
    if (!inboxItemId) return

    const payload: InsertActivityLogInput = {
      action: 'changed' as const,
      resourceType: 'reply' as const,
      resourceId: event.replyId as string,
      propertyId: event.propertyId || null,
      organizationId: event.organizationId,
      userId: null,
      source: 'web' as const,
      eventId: event.eventId,
      payload: {
        subject: 'reply',
        from: null,
        to: 'draft',
        detail: `publication_cancelled:${event.cause}`,
      },
    }
    await deps.queue.add('insert-activity-log', payload)
  }
