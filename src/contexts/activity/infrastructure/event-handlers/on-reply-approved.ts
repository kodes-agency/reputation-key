import type { ReviewReplyApproved } from '#/contexts/review/application/public-api'
import type { InsertActivityLogInput } from '../../application/use-cases/insert-activity-log'
import type { InboxItemLookupPort } from '../../ports/inbox-item-lookup.port'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue; inboxItemLookup: InboxItemLookupPort }

export const onReplyApproved =
  (deps: Deps) =>
  async (event: ReviewReplyApproved): Promise<void> => {
    const inboxItemId = await deps.inboxItemLookup.findBySourceId(
      event.reviewId,
      event.organizationId,
    )
    if (!inboxItemId) return

    const payload: InsertActivityLogInput = {
      action: 'approved' as const,
      resourceType: 'inbox_item' as const,
      resourceId: inboxItemId,
      propertyId: event.propertyId || null,
      organizationId: event.organizationId,
      userId: event.userId || null,
      source: event.source,
      payload: { subject: 'reply', from: null, to: null, detail: null },
    }
    await deps.queue.add('insert-activity-log', payload)
  }
