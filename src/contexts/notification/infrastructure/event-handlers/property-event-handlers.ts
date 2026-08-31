import type { EventBus } from '#/shared/events/event-bus'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { NotificationJobEnqueuePort } from '../inbox-notification-fanout'
import { onPropertyResponsibilityNeeded } from './on-property-responsibility-needed'

export type RegisterPropertyNotificationHandlersDeps = Readonly<{
  events: EventBus
  queue: NotificationJobEnqueuePort
  userLookup: UserLookupPort
  logger: LoggerPort
}>

export function registerPropertyNotificationHandlers(
  deps: RegisterPropertyNotificationHandlersDeps,
): void {
  deps.events.on(
    'property.responsibility_became_needed',
    onPropertyResponsibilityNeeded(deps),
    { consumer: 'notification.property-event-handlers' },
  )
}
