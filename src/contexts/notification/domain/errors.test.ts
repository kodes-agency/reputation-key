import { describe, expect, it } from 'vitest'
import { isNotificationError, notificationError } from './errors'

describe('notification domain errors', () => {
  it('constructs tagged errors with optional details', () => {
    expect(
      notificationError('insert_failed', 'write failed', { eventId: 'event-1' }),
    ).toEqual({
      _tag: 'NotificationError',
      code: 'insert_failed',
      message: 'write failed',
      details: { eventId: 'event-1' },
    })
    expect(notificationError('invalid_input', 'invalid')).not.toHaveProperty('details')
  })

  it.each([
    [notificationError('not_found', 'missing'), true],
    [null, false],
    ['NotificationError', false],
    [{}, false],
    [{ _tag: 'OtherError' }, false],
  ])('recognizes only notification errors', (value, expected) => {
    expect(isNotificationError(value)).toBe(expected)
  })
})
