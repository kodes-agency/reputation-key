import { describe, expect, it } from 'vitest'
import { createNotificationPage } from './notification-page'
import type { Notification } from '../domain/types'

const row = (id: string): Notification => ({ id }) as Notification

describe('notification page boundary', () => {
  it('uses the extra row as exact has-more evidence without returning it', () => {
    const result = createNotificationPage([row('1'), row('2'), row('3')], 2)

    expect(result.notifications.map(({ id }) => id)).toEqual(['1', '2'])
    expect(result.hasMore).toBe(true)
  })

  it('does not manufacture another page when the filtered result exactly fills one', () => {
    const result = createNotificationPage([row('1'), row('2')], 2)

    expect(result.notifications.map(({ id }) => id)).toEqual(['1', '2'])
    expect(result.hasMore).toBe(false)
  })

  it.each([0, -1, 1.5, Number.NaN])('rejects invalid limit %s', (limit) => {
    expect(() => createNotificationPage([], limit)).toThrow(RangeError)
  })
})
