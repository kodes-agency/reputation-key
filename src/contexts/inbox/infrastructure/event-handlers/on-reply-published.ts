// Inbox context — event handler for reply.published
// Auto-transitions the corresponding inbox item open → closed (ADR 0023).
//
// Expand-phase dual path (the durable dispatcher is off in production): the
// durable inbox.on-reply-published consumer performs the same projection via
// the command store; this bus handler keeps the legacy in-process behavior
// (bus emit only — it never received an outboxRepo).

import type { ReviewReplyPublished } from '#/contexts/review/application/public-api'
import type { InboxRepository } from '../../application/ports/inbox.repository'
import type { EventBus } from '#/shared/events/event-bus'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
import { inboxItemStatusChanged } from '../../domain/events'
import { unbrand } from '#/shared/domain/ids'
import { validateTransition } from '../../domain/rules'

export type OnReplyPublishedDeps = Readonly<{
  repo: InboxRepository
  events: EventBus
}>

export const onReplyPublished =
  (deps: OnReplyPublishedDeps) =>
  async (event: ReviewReplyPublished): Promise<void> => {
    return trace('event.onReplyPublished', async () => {
      try {
        const inboxItem = await deps.repo.findBySource(
          'review',
          unbrand(event.reviewId),
          event.organizationId,
        )
        if (!inboxItem) {
          getLogger().warn(
            { reviewId: event.reviewId },
            'inbox: reply.published but no inbox item found',
          )
          return
        }

        const oldStatus = inboxItem.status

        // A published reply always records the firstReplyPublishedAt milestone,
        // even when the item is already `closed`. The status transition itself
        // is still routed through the domain rule so this handler inherits any
        // future graph changes.
        const transitionOk = validateTransition(oldStatus, 'closed').isOk()

        const extraFields: Partial<Record<string, Date>> = {}
        if (!inboxItem.firstReplyPublishedAt) {
          extraFields.firstReplyPublishedAt = event.occurredAt
        }
        if (transitionOk) {
          extraFields.closedAt = event.occurredAt
        }

        // Already closed AND the milestone is already stamped — nothing to persist.
        if (!transitionOk && Object.keys(extraFields).length === 0) return

        // Always persist the milestone (and, when valid, the closed status).
        await deps.repo.updateStatus(
          inboxItem.id,
          inboxItem.organizationId,
          transitionOk ? 'closed' : oldStatus,
          extraFields,
          event.occurredAt,
        )

        // Emit status_changed only for a real transition — a no-op status
        // change would be semantically wrong and downstream consumers key on
        // oldStatus !== newStatus.
        if (transitionOk) {
          await deps.events.emit(
            inboxItemStatusChanged({
              inboxItemId: inboxItem.id,
              organizationId: inboxItem.organizationId,
              propertyId: inboxItem.propertyId,
              oldStatus,
              newStatus: 'closed',
              userId: event.userId ?? undefined,
              occurredAt: event.occurredAt,
            }),
          )
        }
      } catch (err) {
        getLogger().error(
          { err, replyId: event.replyId },
          'inbox: failed to handle reply.published',
        )
      }
    })
  }
