// Inbox context — event handler registration
// Wires all inbox event handlers to the event bus.

import type { EventBus } from '#/shared/events/event-bus'
import type { CreateInboxItemUseCase } from '../../application/use-cases/create-inbox-item'
import type { InboxRepository } from '../../application/ports/inbox.repository'
import type { NewCounterPort } from '../../application/ports/new-counter.port'
import { onReviewCreated } from './on-review-created'
import { onFeedbackSubmitted } from './on-feedback-submitted'
import { onReviewUpdated } from './on-review-updated'
import { onReplyPublished } from './on-reply-published'
import { onReplySubmitted } from './on-reply-submitted'

export type RegisterInboxHandlersDeps = Readonly<{
  events: EventBus
  createInboxItem: CreateInboxItemUseCase
  repo: InboxRepository
  newCounter: NewCounterPort
}>

export const registerInboxHandlers = (deps: RegisterInboxHandlersDeps): void => {
  deps.events.on(
    'review.created',
    onReviewCreated({ createInboxItem: deps.createInboxItem }),
  )
  deps.events.on(
    'guest.feedback.submitted',
    onFeedbackSubmitted({ createInboxItem: deps.createInboxItem }),
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
}
