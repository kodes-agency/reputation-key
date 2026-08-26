import { describe, expect, it } from 'vitest'
import { isNotificationError, notificationError } from './errors'

describe('notification domain errors', () => {
  it('constructs tagged errors with optional context', () => {
    expect(
      notificationError('insert_failed', 'write failed', { eventId: 'event-1' }),
    ).toMatchObject({
      _tag: 'NotificationError',
      code: 'insert_failed',
      message: 'write failed',
      context: { eventId: 'event-1' },
    })
    expect(notificationError('invalid_input', 'invalid')).not.toHaveProperty('context')
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
