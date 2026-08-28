// Guest private-feedback withdrawal closes its manager Inbox work. Inbox holds
// metadata only; the Guest context purges the text before emitting this event.

import type { GuestFeedbackRetracted } from '#/contexts/guest/application/public-api'
import type { InboxRepository } from '../../application/ports/inbox.repository'
import type { InboxCommandStore } from '../../application/ports/inbox-command-store.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { unbrand } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import { applyInboxGuestFeedbackRetraction } from '../guest-feedback-outbox-consumers'

export type OnFeedbackRetractedDeps = Readonly<{
  repo: Pick<InboxRepository, 'findBySource'>
  commandStore: Pick<InboxCommandStore, 'applySourceWithdrawnOnce' | 'recordReceipt'>
  logger: LoggerPort
}>

export const onFeedbackRetracted =
  (deps: OnFeedbackRetractedDeps) =>
  async (event: GuestFeedbackRetracted): Promise<void> => {
    return trace('event.onFeedbackRetracted', async () => {
      try {
        await applyInboxGuestFeedbackRetraction(
          { inboxRepo: deps.repo, commandStore: deps.commandStore },
          {
            eventId: event.eventId,
            feedbackId: unbrand(event.feedbackId),
            organizationId: unbrand(event.organizationId),
            propertyId: unbrand(event.propertyId),
            responseRevision: event.responseRevision,
            occurredAt: event.occurredAt,
          },
        )
      } catch (err) {
        deps.logger.error({ err }, 'inbox: failed to handle guest.feedback.retracted')
      }
    })
  }
