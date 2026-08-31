import type { EventBus } from '#/shared/events/event-bus'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { NotificationJobEnqueuePort } from '../inbox-notification-fanout'
import { onPortalResponsibilityNeeded } from './on-portal-responsibility-needed'

export type RegisterPortalNotificationHandlersDeps = Readonly<{
  events: EventBus
  queue: NotificationJobEnqueuePort
  userLookup: UserLookupPort
  logger: LoggerPort
}>

/**
 * Portal-gated notification subscriptions live separately from the core
 * notification handlers so delayed-execution policy can re-check
 * `portal.write` under a distinct governed consumer identity.
 */
export function registerPortalNotificationHandlers(
  deps: RegisterPortalNotificationHandlersDeps,
): void {
  deps.events.on(
    'portal.responsibility_became_needed',
    onPortalResponsibilityNeeded(deps),
    { consumer: 'notification.portal-event-handlers' },
  )
}
