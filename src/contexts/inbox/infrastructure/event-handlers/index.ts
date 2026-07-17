// Inbox context — event handler registration
// Wires all inbox event handlers to the event bus.
//
// BQC-1.2: review.updated no longer has an inbox handler — its only job was
// syncing denormalized copies, which no longer exist. Live reads resolve via
// the eligibility-enforcing review lookup.

import type { EventBus } from '#/shared/events/event-bus'
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
}>

export const registerInboxHandlers = (deps: RegisterInboxHandlersDeps): void => {
  deps.events.on(
    'review.created',
    onReviewCreated({
      createInboxItem: deps.createInboxItem,
    }),
  )
  deps.events.on(
    'guest.feedback.submitted',
    onFeedbackSubmitted({
      createInboxItem: deps.createInboxItem,
    }),
  )
  deps.events.on(
    'review.reply.published',
    onReplyPublished({
      repo: deps.repo,
      events: deps.events,
    }),
  )
  deps.events.on(
    'review.reply.submitted',
    onReplySubmitted({
      repo: deps.repo,
    }),
  )
  deps.events.on(
    'review.expired',
    onReviewExpired({
      repo: deps.repo,
      events: deps.events,
    }),
  )
}
