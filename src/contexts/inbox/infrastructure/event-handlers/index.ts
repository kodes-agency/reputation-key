// Inbox context — event handler registration
// Wires all inbox event handlers to the event bus.

import type { EventBus } from '#/shared/events/event-bus'
import type { CreateInboxItemUseCase } from '../../application/use-cases/create-inbox-item'
import type { InboxRepository } from '../../application/ports/inbox.repository'
import { onReviewCreated } from './on-review-created'
import { onFeedbackSubmitted } from './on-feedback-submitted'
import { onReviewUpdated } from './on-review-updated'

export type RegisterInboxHandlersDeps = Readonly<{
  events: EventBus
  createInboxItem: CreateInboxItemUseCase
  repo: InboxRepository
}>

export const registerInboxHandlers = (deps: RegisterInboxHandlersDeps): void => {
  deps.events.on('review.created', onReviewCreated(deps))
  deps.events.on('feedback.submitted', onFeedbackSubmitted(deps))
  deps.events.on('review.updated', onReviewUpdated(deps))
}
