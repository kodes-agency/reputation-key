import { describe, expect, it } from 'vitest'
import { isEmailCategoryOfNotice } from './notification-low-ratings'
import type { NotificationCategory, NotificationType } from './notification-types'

describe('isEmailCategoryOfNotice', () => {
  const agreeing: ReadonlyArray<[NotificationType, NotificationCategory]> = [
    ['reply.publish_failed', 'urgent_operational'],
    ['review.created', 'arrivals'],
    ['feedback.created', 'low_ratings'],
  ]

  it.each(agreeing)('accepts %s when row and email are both %s', (type, category) => {
    expect(isEmailCategoryOfNotice(type, category, category)).toBe(true)
  })

  const ratedTypes: ReadonlyArray<NotificationType> = [
    'review.created',
    'review.updated',
    'feedback.created',
  ]

  it.each(ratedTypes)(
    'accepts a %s filed as Low ratings in the app and New reviews by email, and the reverse',
    (type) => {
      expect(isEmailCategoryOfNotice(type, 'low_ratings', 'arrivals')).toBe(true)
      expect(isEmailCategoryOfNotice(type, 'arrivals', 'low_ratings')).toBe(true)
    },
  )

  it('refuses a rated notice whose email sits outside the two rated categories', () => {
    expect(
      isEmailCategoryOfNotice('review.created', 'low_ratings', 'workflow_collaboration'),
    ).toBe(false)
    expect(
      isEmailCategoryOfNotice('review.created', 'urgent_operational', 'arrivals'),
    ).toBe(false)
  })

  it('refuses a notice that is not rated when row and email differ', () => {
    expect(
      isEmailCategoryOfNotice('reply.publish_failed', 'low_ratings', 'arrivals'),
    ).toBe(false)
    expect(isEmailCategoryOfNotice('inbox.assigned', 'arrivals', 'low_ratings')).toBe(
      false,
    )
  })
})
