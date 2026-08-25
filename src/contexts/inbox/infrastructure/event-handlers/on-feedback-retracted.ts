// Guest private-feedback withdrawal closes its manager Inbox work. Inbox holds
// metadata only; the Guest context purges the text before emitting this event.

import type { GuestFeedbackRetracted } from '#/contexts/guest/application/public-api'
import type { InboxRepository } from '../../application/ports/inbox.repository'
import type { EventBus } from '#/shared/events/event-bus'
import { unbrand } from '#/shared/domain/ids'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
import { inboxItemStatusChanged } from '../../domain/events'
import { validateTransition } from '../../domain/rules'

export type OnFeedbackRetractedDeps = Readonly<{
  repo: InboxRepository
  events: EventBus
}>

export const onFeedbackRetracted =
  (deps: OnFeedbackRetractedDeps) =>
  async (event: GuestFeedbackRetracted): Promise<void> => {
    return trace('event.onFeedbackRetracted', async () => {
      try {
        const item = await deps.repo.findBySource(
          'feedback',
          unbrand(event.feedbackId),
          event.organizationId,
        )
        if (!item || validateTransition(item.status, 'closed').isErr()) return
        await deps.repo.updateStatus(
          item.id,
          item.organizationId,
          'closed',
          { closedAt: event.occurredAt },
          event.occurredAt,
        )
        await deps.events.emit(
          inboxItemStatusChanged({
            inboxItemId: item.id,
            organizationId: item.organizationId,
            propertyId: item.propertyId,
            oldStatus: item.status,
            newStatus: 'closed',
            occurredAt: event.occurredAt,
          }),
        )
      } catch (err) {
        getLogger().error({ err }, 'inbox: failed to handle guest.feedback.retracted')
      }
    })
  }
