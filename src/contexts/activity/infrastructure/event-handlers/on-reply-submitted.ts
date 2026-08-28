import type { ReviewReplySubmitted } from '#/contexts/review/application/public-api'
import type { ProjectRecentActivityInput } from '../../application/use-cases/project-recent-activity'
import type { InboxItemLookupPort } from '../../ports/inbox-item-lookup.port'
import type { Queue } from 'bullmq'

type Deps = { queue: Queue; inboxItemLookup: InboxItemLookupPort }

export const onReplySubmitted =
  (deps: Deps) =>
  async (event: ReviewReplySubmitted): Promise<void> => {
    const inboxItemId = await deps.inboxItemLookup.findBySourceId(
      event.reviewId,
      event.organizationId,
    )
    if (!inboxItemId) return

    const payload: ProjectRecentActivityInput = {
      action: 'submitted' as const,
      resourceType: 'reply' as const,
      resourceId: event.replyId as string,
      propertyId: event.propertyId || null,
      organizationId: event.organizationId,
      userId: event.userId || null,
      source: event.source,
      eventId: event.eventId,
      payload: { subject: 'reply', from: null, to: null, detail: null },
    }
    await deps.queue.add('project-recent-activity', payload)
  }
