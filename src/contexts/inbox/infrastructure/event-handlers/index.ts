// Inbox context — event handler registration
// Wires all inbox event handlers to the event bus.
//
// BQC-1.2: review.updated no longer has an inbox handler — its only job was
// syncing denormalized copies, which no longer exist. Live reads resolve via
// the eligibility-enforcing review lookup.
//
// BQC-3.9: per-family durable cutover (phase BQC-3 §7). While a family is
// record-only or shadow the bus handler registers (record-only: bus is the
// primary projection path; shadow: both paths run and the harness compares
// outcomes). When a family reaches 'switch' the durable path is authoritative
// and the family's bus handlers are NOT registered — the legacy primary is
// retired for that family, flag-gated (never deleted) so rollback is a flag
// move + reboot. The bus registrations stay literal .on calls: the event/job
// catalogue guard discovers bus consumers by scanning this module.

import type { EventBus } from '#/shared/events/event-bus'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { CutoverFamily, CutoverState } from '#/shared/outbox/cutover-flags'
import type { CreateInboxItem } from '../../application/use-cases/create-inbox-item'
import type { InboxRepository } from '../../application/ports/inbox.repository'
import type { InboxCommandStore } from '../../application/ports/inbox-command-store.port'
import { onReviewCreated } from './on-review-created'
import { onFeedbackSubmitted } from './on-feedback-submitted'
import { onFeedbackRetracted } from './on-feedback-retracted'
import { onReplySubmitted } from './on-reply-submitted'
import { onReviewExpired } from './on-review-expired'

export type RegisterInboxHandlersDeps = Readonly<{
  events: EventBus
  createInboxItem: CreateInboxItem
  repo: InboxRepository
  commandStore: InboxCommandStore
  logger: LoggerPort
  /** BQC-3.9: composition-resolved, per-family durable cutover state. */
  cutoverState: (family: CutoverFamily) => CutoverState
}>

export const registerInboxHandlers = (deps: RegisterInboxHandlersDeps): void => {
  if (deps.cutoverState('review.created') !== 'switch') {
    deps.events.on(
      'review.created',
      onReviewCreated({
        createInboxItem: deps.createInboxItem,
        logger: deps.logger,
      }),

      { consumer: 'inbox.event-handlers' },
    )
  }
  // BQC-3.9: review.created switched — legacy bus path retired for this
  // family; the durable consumer (inbox.on-review-created) is authoritative.

  deps.events.on(
    'guest.feedback.submitted',
    onFeedbackSubmitted({
      createInboxItem: deps.createInboxItem,
      logger: deps.logger,
    }),

    { consumer: 'inbox.event-handlers' },
  )

  deps.events.on(
    'guest.feedback.retracted',
    onFeedbackRetracted({
      repo: deps.repo,
      commandStore: deps.commandStore,
      logger: deps.logger,
    }),
    { consumer: 'inbox.event-handlers' },
  )

  // `review.reply.published` is deliberately not registered here. Provider
  // acceptance/publication workflow facts cannot close Inbox work; only the
  // durable `review.reply.observed` consumer may apply the exact current
  // Google observation head.

  deps.events.on(
    'review.reply.submitted',
    onReplySubmitted({
      repo: deps.repo,
      logger: deps.logger,
    }),

    { consumer: 'inbox.event-handlers' },
  )

  if (deps.cutoverState('review.expired') !== 'switch') {
    deps.events.on(
      'review.expired',
      onReviewExpired({
        repo: deps.repo,
        logger: deps.logger,
      }),

      { consumer: 'inbox.event-handlers' },
    )
  }
  // BQC-3.9: review.expired switched — legacy bus path retired for this
  // family; inbox.on-review-expired is authoritative.
}
