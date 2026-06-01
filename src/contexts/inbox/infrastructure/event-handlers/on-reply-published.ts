// Inbox context — event handler for reply.published
// Auto-transitions the corresponding inbox item to 'addressed'.

import type { ReplyPublished } from '#/contexts/review/application/public-api'
import type { InboxRepository } from '../../application/ports/inbox.repository'
import type { NewCounterPort } from '../../application/ports/new-counter.port'
import type { EventBus } from '#/shared/events/event-bus'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
import { inboxStatusChanged } from '../../domain/events'

export type OnReplyPublishedDeps = Readonly<{
  repo: InboxRepository
  events: EventBus
  newCounter: NewCounterPort
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

        const oldStatus = inboxItem.status

        const extraFields: Partial<Record<string, Date>> = {
          addressedAt: event.occurredAt,
        }
        if (!inboxItem.firstReplyPublishedAt) {
          extraFields.firstReplyPublishedAt = event.occurredAt
        }

        await deps.repo.updateStatus(
          inboxItem.id,
          inboxItem.organizationId,
          'addressed',
          extraFields,
          event.occurredAt,
        )

        // Decrement new counter if transitioning away from 'new'
        if (oldStatus === 'new') {
          try {
            await deps.newCounter.decrement(inboxItem.organizationId)
          } catch (err) {
            getLogger().warn(
              { err, organizationId: inboxItem.organizationId },
              'inbox: new counter decrement failed on reply.published',
            )
          }
        }

        // Emit status changed event
        await deps.events.emit(
          inboxStatusChanged({
            inboxItemId: inboxItem.id,
            organizationId: inboxItem.organizationId,
            oldStatus,
            newStatus: 'addressed',
            occurredAt: event.occurredAt,
          }),
        )
      } catch (err) {
        getLogger().error(
          { err, replyId: event.replyId },
          'inbox: failed to handle reply.published',
        )
      }
    })
  }
