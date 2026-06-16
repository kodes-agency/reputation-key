// Inbox context — event handler for review.expired
// Archives inbox items when their source review is purged, preventing
// orphaned items that show "Anonymous" (reviewerName lookup returns null).

import type { ReviewExpired } from '#/contexts/review/application/public-api'
import type { InboxRepository } from '../../application/ports/inbox.repository'
import type { NewCounterPort } from '../../application/ports/new-counter.port'
import { unbrand } from '#/shared/domain/ids'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

export type OnReviewExpiredDeps = Readonly<{
  repo: InboxRepository
  newCounter: NewCounterPort
}>

export const onReviewExpired =
  (deps: OnReviewExpiredDeps) =>
  async (event: ReviewExpired): Promise<void> => {
    return trace('event.onReviewExpired', async () => {
      try {
        const sourceId = unbrand(event.reviewId)
        const item = await deps.repo.findBySource(
          'review',
          sourceId,
          event.organizationId,
        )
        if (!item) return

        // Archive the inbox item so it leaves the active view but
        // retains its denormalized reviewerName for historical context.
        await deps.repo.updateStatus(
          item.id,
          item.organizationId,
          'archived',
          { archivedAt: event.occurredAt },
          event.occurredAt,
        )

        // Decrement new counter if the item was 'new'
        if (item.status === 'new') {
          try {
            await deps.newCounter.decrement(item.organizationId)
          } catch {
            // counter is best-effort
          }
        }
      } catch (err) {
        getLogger().error(
          { err, reviewId: event.reviewId },
          'inbox: failed to handle review.expired',
        )
      }
    })
  }
