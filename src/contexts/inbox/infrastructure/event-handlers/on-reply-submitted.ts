// Inbox context — event handler for reply.submitted
// Sets the firstReplySubmittedAt milestone on the associated inbox item.

import type { ReplySubmitted } from '#/contexts/review/application/public-api'
import type { InboxRepository } from '../../application/ports/inbox.repository'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

export type OnReplySubmittedDeps = Readonly<{
  repo: InboxRepository
}>

export const onReplySubmitted =
  (deps: OnReplySubmittedDeps) =>
  async (event: ReplySubmitted): Promise<void> => {
    return trace('event.onReplySubmitted', async () => {
      try {
        const inboxItem = await deps.repo.findBySource(
          'review',
          event.reviewId,
          event.organizationId,
        )
        if (!inboxItem) {
          getLogger().warn(
            { reviewId: event.reviewId },
            'inbox: reply.submitted but no inbox item found',
          )
          return
        }

        // Only set the milestone if it hasn't been set yet
        if (inboxItem.firstReplySubmittedAt) {
          return
        }

        await deps.repo.updateStatus(
          inboxItem.id,
          inboxItem.organizationId,
          inboxItem.status,
          { firstReplySubmittedAt: event.occurredAt },
          event.occurredAt,
        )
      } catch (err) {
        getLogger().error(
          { err, replyId: event.replyId },
          'inbox: failed to handle reply.submitted',
        )
      }
    })
  }
