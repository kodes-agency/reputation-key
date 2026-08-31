import { describe, expect, it } from 'vitest'
import { GOVERNING_NOTIFICATION_CATEGORIES } from '../domain/notification-delivery-policy'
import { NOTIFICATION_LIST_FILTERS } from './notification-list-filter'

describe('notification list filters', () => {
  it('keeps feed-state filters ahead of every governed category without duplicates', () => {
    expect(NOTIFICATION_LIST_FILTERS).toEqual([
      'all',
      'unread',
      'urgent',
      ...GOVERNING_NOTIFICATION_CATEGORIES,
    ])
    expect(new Set(NOTIFICATION_LIST_FILTERS).size).toBe(NOTIFICATION_LIST_FILTERS.length)
  })
})
