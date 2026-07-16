// Inbox context — event handler for review.expired
// Closes the inbox item when its source review is purged, and scrubs
// denormalized raw source content (snippet, reviewer name) so PII does not
// outlive the review cache (BQR-3.3 / finding 4.3 / ADR 0031).

import type { ReviewExpired } from '#/contexts/review/application/public-api'
import type { InboxRepository } from '../../application/ports/inbox.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type { InboxItemId, OrganizationId } from '#/shared/domain/ids'
import { unbrand } from '#/shared/domain/ids'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
import { inboxItemStatusChanged } from '../../domain/events'
import { validateTransition } from '../../domain/rules'
import { emitAndRecord, type OutboxRepository } from '#/shared/outbox'

export type OnReviewExpiredDeps = Readonly<{
  repo: InboxRepository
  events: EventBus
  outboxRepo?: OutboxRepository
}>

/**
 * Clear denormalized raw review text from an inbox projection.
 * Idempotent — safe when fields are already null.
 */
export async function scrubInboxSourceContent(
  repo: InboxRepository,
  item: Readonly<{ id: InboxItemId; organizationId: OrganizationId }>,
  now: Date,
): Promise<void> {
  await repo.syncDenormalizedFields(
    item.id,
    item.organizationId,
    { snippet: null, reviewerName: null },
    now,
  )
}

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

        // BQR-3.3: always scrub raw copies when source expires (even if already closed).
        await scrubInboxSourceContent(deps.repo, item, event.occurredAt)

        // Route through the domain transition rule (open → closed).
        if (validateTransition(item.status, 'closed').isErr()) return

        const oldStatus = item.status

        await deps.repo.updateStatus(
          item.id,
          item.organizationId,
          'closed',
          { closedAt: event.occurredAt },
          event.occurredAt,
        )

        // Emit status changed event — symmetric with on-reply-published
        await emitAndRecord(
          deps.events,
          deps.outboxRepo,
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
