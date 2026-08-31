import { describe, expect, it } from 'vitest'
import { parseGbpNotificationSubscriptionConfig } from './notification-subscription-config'

describe('parseGbpNotificationSubscriptionConfig', () => {
  it('keeps push explicitly disabled when no topic is configured', () => {
    expect(parseGbpNotificationSubscriptionConfig('  ', 'NOT_A_TYPE')).toEqual({
      enabled: false,
      pubsubTopic: '',
      notificationTypes: [],
    })
  })

  it('trims and deduplicates configured notification types', () => {
    expect(
      parseGbpNotificationSubscriptionConfig(
        ' projects/repkey/topics/reviews ',
        ' UPDATED_REVIEW,NEW_REVIEW,UPDATED_REVIEW ',
      ),
    ).toEqual({
      enabled: true,
      pubsubTopic: 'projects/repkey/topics/reviews',
      notificationTypes: ['UPDATED_REVIEW', 'NEW_REVIEW'],
    })
  })

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['NEW_REVIEW,', 'empty'],
    ['NEW_REVIEW,DELETED_REVIEW', 'unknown'],
  ])('rejects %s notification types for an enabled topic (%s)', (raw) => {
    expect(() =>
      parseGbpNotificationSubscriptionConfig('projects/repkey/topics/reviews', raw),
    ).toThrow('GBP_PUBSUB_NOTIFICATION_TYPES')
  })
})
