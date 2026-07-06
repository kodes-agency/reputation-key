// Inbox context — event handler for reply.published
// Auto-transitions the corresponding inbox item to 'addressed'.

import type { ReviewReplyPublished } from '#/contexts/review/application/public-api'
import type { InboxRepository } from '../../application/ports/inbox.repository'
import type { NewCounterPort } from '../../application/ports/new-counter.port'
import type { EventBus } from '#/shared/events/event-bus'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
import { inboxItemStatusChanged } from '../../domain/events'
import { unbrand } from '#/shared/domain/ids'
import { validateTransition } from '../../domain/rules'

export type OnReplyPublishedDeps = Readonly<{
  repo: InboxRepository
  events: EventBus
  newCounter: NewCounterPort
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
        // even when the item is already `addressed` or `archived` (where the
        // status graph has no edge into `addressed`). The status transition
        // itself is still routed through the domain rule so this handler
        // inherits any future graph changes (INBOX-02).
        const transitionOk = validateTransition(oldStatus, 'addressed').isOk()

        const extraFields: Partial<Record<string, Date>> = {}
        if (!inboxItem.firstReplyPublishedAt) {
          extraFields.firstReplyPublishedAt = event.occurredAt
        }
        if (transitionOk) {
          extraFields.addressedAt = event.occurredAt
        }

        // Already addressed (or otherwise non-transitionable) AND the
        // milestone is already stamped — nothing to persist.
        if (!transitionOk && Object.keys(extraFields).length === 0) return

        // Always persist the milestone (and, when valid, the addressed status).
        // When no transition is possible we keep the current status so the
        // item still reflects the published reply via firstReplyPublishedAt.
        await deps.repo.updateStatus(
          inboxItem.id,
          inboxItem.organizationId,
          transitionOk ? 'addressed' : oldStatus,
          extraFields,
          event.occurredAt,
        )

        // Decrement new counter only when actually transitioning away from 'new'.
        if (transitionOk && oldStatus === 'new') {
          try {
            await deps.newCounter.decrement(inboxItem.organizationId)
          } catch (err) {
            getLogger().warn(
              { err, organizationId: inboxItem.organizationId },
              'inbox: new counter decrement failed on reply.published',
            )
          }
        }

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
              newStatus: 'addressed',
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
