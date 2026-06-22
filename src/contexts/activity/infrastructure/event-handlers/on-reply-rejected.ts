import type { ReviewReplyRejected } from '#/contexts/review/application/public-api'
import type { InsertActivityLogInput } from '../../application/use-cases/insert-activity-log'
import type { InboxItemLookupPort } from '../../ports/inbox-item-lookup.port'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue; inboxItemLookup: InboxItemLookupPort }

export const onReplyRejected =
  (deps: Deps) =>
  async (event: ReviewReplyRejected): Promise<void> => {
    const inboxItemId = await deps.inboxItemLookup.findBySourceId(
      event.reviewId,
      event.organizationId,
    )
    if (!inboxItemId) return

    const payload: InsertActivityLogInput = {
      action: 'rejected' as const,
      resourceType: 'reply' as const,
      resourceId: event.replyId as string,
      propertyId: event.propertyId || null,
      organizationId: event.organizationId,
      userId: event.userId || null,
      source: event.source,
      eventId: event.eventId,
      payload: { subject: 'reply', from: null, to: null, detail: event.reason },
    }
    await deps.queue.add('insert-activity-log', payload)
  }
