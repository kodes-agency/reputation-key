import {
  GBP_NOTIFICATION_TYPES,
  type GbpNotificationType,
} from './ports/mybusiness-notifications.port'

export type GbpNotificationSubscriptionConfig =
  | Readonly<{
      enabled: false
      pubsubTopic: ''
      notificationTypes: readonly []
    }>
  | Readonly<{
      enabled: true
      pubsubTopic: string
      notificationTypes: ReadonlyArray<GbpNotificationType>
    }>

const ALLOWED_NOTIFICATION_TYPES = new Set<string>(GBP_NOTIFICATION_TYPES)

function isGbpNotificationType(value: string): value is GbpNotificationType {
  return ALLOWED_NOTIFICATION_TYPES.has(value)
}

export function parseGbpNotificationSubscriptionConfig(
  rawTopic: string,
  rawNotificationTypes: string,
): GbpNotificationSubscriptionConfig {
  const pubsubTopic = rawTopic.trim()
  if (pubsubTopic.length === 0) {
    return Object.freeze({
      enabled: false,
      pubsubTopic: '',
      notificationTypes: Object.freeze([] as const),
    })
  }

  const notificationTypes: GbpNotificationType[] = []
  for (const value of rawNotificationTypes.split(',').map((item) => item.trim())) {
    if (!isGbpNotificationType(value)) {
      throw new Error(
        'GBP_PUBSUB_NOTIFICATION_TYPES must contain only NEW_REVIEW and UPDATED_REVIEW when GBP_PUBSUB_TOPIC is configured',
      )
    }
    if (!notificationTypes.includes(value)) notificationTypes.push(value)
  }

  return Object.freeze({
    enabled: true,
    pubsubTopic,
    notificationTypes: Object.freeze(notificationTypes),
  })
}
