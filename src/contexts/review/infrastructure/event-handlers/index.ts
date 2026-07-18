import type { EventBus } from '#/shared/events/event-bus'
import type { ReviewQueuePort } from '../../application/ports/review-queue.port'
import type { CancelPublicationsForConnection } from '../../application/use-cases/cancel-publications'
import { onPropertyCreated } from './on-property-created'
import { onGoogleAccountDisconnected } from './on-google-account-disconnected'

export type RegisterReviewHandlersDeps = Readonly<{
  events: EventBus
  queue: ReviewQueuePort
  /** BQC-3.8: disconnect cancellation of in-flight reply publications. */
  cancelPublicationsForConnection: CancelPublicationsForConnection
}>

export const registerReviewHandlers = (deps: RegisterReviewHandlersDeps): void => {
  deps.events.on('property.created', onPropertyCreated({ queue: deps.queue }), {
    consumer: 'review.event-handlers',
  })
  deps.events.on(
    'integration.google_account.disconnected',
    onGoogleAccountDisconnected({
      cancelPublicationsForConnection: deps.cancelPublicationsForConnection,
    }),
    { consumer: 'review.event-handlers' },
  )
}
