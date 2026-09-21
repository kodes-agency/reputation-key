import { describe, expect, it } from 'vitest'
import {
  createNotificationPage,
  isNewerFeedPosition,
  type NotificationFeedRow,
} from './notification-page'
import type { Notification } from '../domain/notification-types'

const row = (id: string): NotificationFeedRow => ({
  notification: { id } as Notification,
  cursor: { at: `2026-09-01T12:00:0${id}.000000Z`, id },
})

describe('notification page boundary', () => {
  it('uses the extra row as exact has-more evidence without returning it', () => {
    const result = createNotificationPage([row('3'), row('2'), row('1')], 2)

    expect(result.notifications.map(({ id }) => id)).toEqual(['3', '2'])
    expect(result.hasMore).toBe(true)
  })

  it('continues from the last returned row, so the evidence row opens the next page', () => {
    const result = createNotificationPage([row('3'), row('2'), row('1')], 2)

    expect(result.nextCursor).toEqual(row('2').cursor)
  })

  it('does not manufacture another page when the filtered result exactly fills one', () => {
    const result = createNotificationPage([row('2'), row('1')], 2)

    expect(result.notifications.map(({ id }) => id)).toEqual(['2', '1'])
    expect(result.hasMore).toBe(false)
    expect(result.nextCursor).toBeNull()
  })

  it.each([0, -1, 1.5, Number.NaN])('rejects invalid limit %s', (limit) => {
    expect(() => createNotificationPage([], limit)).toThrow(RangeError)
  })
})

describe('feed position order', () => {
  const at = (instant: string, id: string) => ({ at: instant, id })

  it('orders by latest activity down to the microsecond', () => {
    const later = at(
      '2026-09-01T12:00:00.123457Z',
      '00000000-0000-4000-8000-000000000001',
    )
    const earlier = at(
      '2026-09-01T12:00:00.123456Z',
      '00000000-0000-4000-8000-000000000002',
    )

    expect(isNewerFeedPosition(later, earlier)).toBe(true)
    expect(isNewerFeedPosition(earlier, later)).toBe(false)
  })

  it('breaks an instant tie on id, like the ORDER BY', () => {
    const instant = '2026-09-01T12:00:00.000000Z'
    const larger = at(instant, '00000000-0000-4000-8000-00000000000b')
    const smaller = at(instant, '00000000-0000-4000-8000-00000000000a')

    expect(isNewerFeedPosition(larger, smaller)).toBe(true)
    expect(isNewerFeedPosition(smaller, larger)).toBe(false)
    expect(isNewerFeedPosition(larger, larger)).toBe(false)
  })
})
