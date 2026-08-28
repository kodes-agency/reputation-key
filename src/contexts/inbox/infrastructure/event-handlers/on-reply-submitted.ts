// Inbox context — event handler for reply.submitted
// Sets the firstReplySubmittedAt milestone on the associated inbox item.

import type { ReviewReplySubmitted } from '#/contexts/review/application/public-api'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { InboxRepository } from '../../application/ports/inbox.repository'
import { trace } from '#/shared/observability/trace'
import { unbrand } from '#/shared/domain/ids'

export type OnReplySubmittedDeps = Readonly<{
  repo: InboxRepository
  logger: LoggerPort
}>

export const onReplySubmitted =
  (deps: OnReplySubmittedDeps) =>
  async (event: ReviewReplySubmitted): Promise<void> => {
    return trace('event.onReplySubmitted', async () => {
      try {
        const inboxItem = await deps.repo.findBySource(
          'review',
          unbrand(event.reviewId),
          event.organizationId,
        )
        if (!inboxItem) {
          deps.logger.warn('inbox: reply.submitted but no inbox item found')
          return
        }

        // Only set the milestone if it hasn't been set yet
        if (inboxItem.firstReplySubmittedAt) {
          return
        }

        // Milestone only. This handler used to pass the item's own status back
        // through the status seam, which made it an unfenced writer of the
        // `inbox_items.status` compatibility mirror for no benefit.
        await deps.repo.stampReplyMilestones(
          inboxItem.id,
          inboxItem.organizationId,
          { firstReplySubmittedAt: event.occurredAt },
          event.occurredAt,
        )
      } catch (err) {
        deps.logger.error({ err }, 'inbox: failed to handle reply.submitted')
      }
    })
  }
