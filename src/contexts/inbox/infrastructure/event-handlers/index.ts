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
import {
  resolveCutoverState,
  type CutoverFamily,
  type CutoverState,
} from '#/shared/outbox/cutover-flags'
import type { CreateInboxItem } from '../../application/use-cases/create-inbox-item'
import type { InboxRepository } from '../../application/ports/inbox.repository'
import { onReviewCreated } from './on-review-created'
import { onFeedbackSubmitted } from './on-feedback-submitted'
import { onReplyPublished } from './on-reply-published'
import { onReplySubmitted } from './on-reply-submitted'
import { onReviewExpired } from './on-review-expired'

export type RegisterInboxHandlersDeps = Readonly<{
  events: EventBus
  createInboxItem: CreateInboxItem
  repo: InboxRepository
  /**
   * BQC-3.9: per-family cutover state resolver — defaults to the env
   * resolution (DURABLE_CUTOVER_INBOX*). Tests inject a stub.
   */
  cutoverState?: (family: CutoverFamily) => CutoverState
}>

export const registerInboxHandlers = (deps: RegisterInboxHandlersDeps): void => {
  const cutover = deps.cutoverState ?? resolveCutoverState

  if (cutover('review.created') !== 'switch') {
    deps.events.on(
      'review.created',
      onReviewCreated({
        createInboxItem: deps.createInboxItem,
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
    }),

    { consumer: 'inbox.event-handlers' },
  )

  if (cutover('review.reply.published') !== 'switch') {
    deps.events.on(
      'review.reply.published',
      onReplyPublished({
        repo: deps.repo,
        events: deps.events,
      }),

      { consumer: 'inbox.event-handlers' },
    )
  }
  // BQC-3.9: review.reply.published switched — legacy bus path retired for
  // this family; inbox.on-reply-published is authoritative.

  deps.events.on(
    'review.reply.submitted',
    onReplySubmitted({
      repo: deps.repo,
    }),

    { consumer: 'inbox.event-handlers' },
  )

  if (cutover('review.expired') !== 'switch') {
    deps.events.on(
      'review.expired',
      onReviewExpired({
        repo: deps.repo,
        events: deps.events,
      }),

      { consumer: 'inbox.event-handlers' },
    )
  }
  // BQC-3.9: review.expired switched — legacy bus path retired for this
  // family; inbox.on-review-expired is authoritative.
}
