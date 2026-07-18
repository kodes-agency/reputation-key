import type { EventBus } from '#/shared/events/event-bus'
import type { ReviewQueuePort } from '../../application/ports/review-queue.port'
import { onPropertyCreated } from './on-property-created'

export type RegisterReviewHandlersDeps = Readonly<{
  events: EventBus
  queue: ReviewQueuePort
}>

export const registerReviewHandlers = (deps: RegisterReviewHandlersDeps): void => {
  deps.events.on('property.created', onPropertyCreated({ queue: deps.queue }), {
    consumer: 'review.event-handlers',
  })
}
