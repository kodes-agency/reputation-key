import { describe, expect, it } from 'vitest'
import { activityError, isActivityError } from './errors'

describe('activity domain errors', () => {
  it('constructs tagged errors with optional context', () => {
    expect(
      activityError('insert_failed', 'write failed', { eventId: 'event-1' }),
    ).toEqual({
      _tag: 'ActivityError',
      code: 'insert_failed',
      message: 'write failed',
      context: { eventId: 'event-1' },
    })
    expect(activityError('invalid_input', 'invalid')).not.toHaveProperty('context')
  })

  it.each([
    [activityError('invalid_input', 'invalid'), true],
    [null, false],
    ['ActivityError', false],
    [{}, false],
    [{ _tag: 'OtherError' }, false],
  ])('recognizes only activity errors', (value, expected) => {
    expect(isActivityError(value)).toBe(expected)
  })
})
