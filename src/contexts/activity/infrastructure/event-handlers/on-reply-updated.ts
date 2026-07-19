import type { ReviewReplyUpdated } from '#/contexts/review/application/public-api'
import type { InsertActivityLogInput } from '../../application/use-cases/insert-activity-log'
import type { InboxItemLookupPort } from '../../ports/inbox-item-lookup.port'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue; inboxItemLookup: InboxItemLookupPort }

// Audit trail for edit-and-republish: a published reply's text was edited and
// re-entered the publication machine. Mirrors on-reply-publication-cancelled:
// scoped to reviews with an inbox item; the payload is identifier-only (never
// the reply text).
export const onReplyUpdated =
  (deps: Deps) =>
  async (event: ReviewReplyUpdated): Promise<void> => {
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
      userId: event.userId ?? null,
      source: 'web' as const,
      eventId: event.eventId,
      payload: {
        subject: 'reply',
        from: 'published',
        to: 'approved',
        detail: 'edited_for_republish',
      },
    }
    await deps.queue.add('insert-activity-log', payload)
  }
