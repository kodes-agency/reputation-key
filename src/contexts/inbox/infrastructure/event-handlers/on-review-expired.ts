// Inbox context — event handler for review.expired
// Closes orphaned inbox items when their source review is purged, preventing
// orphaned items that show "Anonymous" (reviewerName lookup returns null).

import type { ReviewExpired } from '#/contexts/review/application/public-api'
import type { InboxRepository } from '../../application/ports/inbox.repository'
import type { EventBus } from '#/shared/events/event-bus'
import { unbrand } from '#/shared/domain/ids'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
import { inboxItemStatusChanged } from '../../domain/events'
import { validateTransition } from '../../domain/rules'

export type OnReviewExpiredDeps = Readonly<{
  repo: InboxRepository
  events: EventBus
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

        // Route through the domain transition rule (open → closed).
        if (validateTransition(item.status, 'closed').isErr()) return

        const oldStatus = item.status

        // Close the inbox item so it leaves the active view but retains its
        // denormalized reviewerName for historical context.
        await deps.repo.updateStatus(
          item.id,
          item.organizationId,
          'closed',
          { closedAt: event.occurredAt },
          event.occurredAt,
        )

        // Emit status changed event — symmetric with on-reply-published
        await deps.events.emit(
          inboxItemStatusChanged({
            inboxItemId: item.id,
            organizationId: item.organizationId,
            propertyId: item.propertyId,
            oldStatus,
            newStatus: 'closed',
            occurredAt: event.occurredAt,
          }),
        )
      } catch (err) {
        getLogger().error(
          { err, reviewId: event.reviewId },
          'inbox: failed to handle review.expired',
        )
      }
    })
  }
