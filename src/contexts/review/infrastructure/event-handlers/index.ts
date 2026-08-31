import type { EventBus } from '#/shared/events/event-bus'
import type { CancelPublicationsForConnection } from '../../application/use-cases/cancel-publications'
import {
  onGoogleAccountDisconnected,
  type ReviewEventLogger,
} from './on-google-account-disconnected'

export type RegisterReviewHandlersDeps = Readonly<{
  events: EventBus
  logger: ReviewEventLogger
  /** BQC-3.8: disconnect cancellation of in-flight reply publications. */
  cancelPublicationsForConnection: CancelPublicationsForConnection
}>

export const registerReviewHandlers = (deps: RegisterReviewHandlersDeps): void => {
  deps.events.on(
    'integration.google_account.disconnected',
    onGoogleAccountDisconnected({
      cancelPublicationsForConnection: deps.cancelPublicationsForConnection,
      logger: deps.logger,
    }),
    { consumer: 'review.event-handlers' },
  )
}
