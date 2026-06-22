// Inbox context — event handler registration
// Wires all inbox event handlers to the event bus.

import type { EventBus } from '#/shared/events/event-bus'
import type { CreateInboxItemUseCase } from '../../application/use-cases/create-inbox-item'
import type { InboxRepository } from '../../application/ports/inbox.repository'
import type { NewCounterPort } from '../../application/ports/new-counter.port'
import type { FeedbackLookupPort } from '../../application/ports/feedback-lookup.port'
import { onReviewCreated } from './on-review-created'
import { onFeedbackSubmitted } from './on-feedback-submitted'
import { onReviewUpdated } from './on-review-updated'
import { onReplyPublished } from './on-reply-published'
import { onReplySubmitted } from './on-reply-submitted'
import { onReviewExpired } from './on-review-expired'

export type RegisterInboxHandlersDeps = Readonly<{
  events: EventBus
  createInboxItem: CreateInboxItemUseCase
  repo: InboxRepository
  newCounter: NewCounterPort
  feedbackLookup: FeedbackLookupPort
}>

export const registerInboxHandlers = (deps: RegisterInboxHandlersDeps): void => {
  deps.events.on(
    'review.created',
    onReviewCreated({ createInboxItem: deps.createInboxItem }),
  )
  deps.events.on(
    'guest.feedback.submitted',
    onFeedbackSubmitted({
      createInboxItem: deps.createInboxItem,
      feedbackLookup: deps.feedbackLookup,
    }),
  )
  deps.events.on('review.updated', onReviewUpdated(deps))
  deps.events.on(
    'review.reply.published',
    onReplyPublished({
      repo: deps.repo,
      events: deps.events,
      newCounter: deps.newCounter,
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
      newCounter: deps.newCounter,
    }),
  )
}
