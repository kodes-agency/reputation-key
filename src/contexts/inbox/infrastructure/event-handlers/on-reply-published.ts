// Inbox context — event handler for reply.published
// Auto-transitions the corresponding inbox item to 'addressed'.

import type { ReplyPublished } from '#/contexts/review/application/public-api'
import type { InboxRepository } from '../../application/ports/inbox.repository'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

export type OnReplyPublishedDeps = Readonly<{
  repo: InboxRepository
}>

export const onReplyPublished =
  (deps: OnReplyPublishedDeps) =>
  async (event: ReplyPublished): Promise<void> => {
    return trace('event.onReplyPublished', async () => {
      try {
        const inboxItem = await deps.repo.findBySource(
          'review',
          event.reviewId,
          event.organizationId,
        )
        if (!inboxItem) {
          getLogger().warn(
            { reviewId: event.reviewId },
            'inbox: reply.published but no inbox item found',
          )
          return
        }

        if (inboxItem.status === 'addressed' || inboxItem.status === 'archived') return

        await deps.repo.updateStatus(
          inboxItem.id,
          inboxItem.organizationId,
          'addressed',
          { addressedAt: event.occurredAt },
          event.occurredAt,
        )
      } catch (err) {
        getLogger().error(
          { err, replyId: event.replyId },
          'inbox: failed to handle reply.published',
        )
      }
    })
  }
