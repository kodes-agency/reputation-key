import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearRecordedErrors,
  latestRecordedError,
  listRecordedErrors,
  rememberRecordedError,
} from './recorded-browser-errors'

const id = (char: string) => char.repeat(32)

beforeEach(() => {
  clearRecordedErrors()
})

describe('recorded browser errors', () => {
  it('starts empty and reports no latest error', () => {
    expect(listRecordedErrors()).toEqual([])
    expect(latestRecordedError()).toBeNull()
  })

  it('returns the most recent error first', () => {
    rememberRecordedError(id('a'), 1)
    rememberRecordedError(id('b'), 2)

    expect(latestRecordedError()).toEqual({ eventId: id('b'), recordedAt: 2 })
    expect(listRecordedErrors().map((entry) => entry.eventId)).toEqual([id('b'), id('a')])
  })

  it('keeps at most five errors', () => {
    for (const char of ['a', 'b', 'c', 'd', 'e', 'f']) rememberRecordedError(id(char))

    expect(listRecordedErrors()).toHaveLength(5)
    expect(listRecordedErrors().map((entry) => entry.eventId)).not.toContain(id('a'))
  })

  it('does not record the same event twice', () => {
    rememberRecordedError(id('a'))
    rememberRecordedError(id('a'))

    expect(listRecordedErrors()).toHaveLength(1)
  })

  it.each([
    ['undefined', undefined],
    ['an empty string', ''],
    ['uppercase hex', 'A'.repeat(32)],
    ['a short id', 'a'.repeat(31)],
    ['a long id', 'a'.repeat(33)],
    ['an error message', 'The reviews page crashed for guest Jane.'],
    ['a data URI', 'data:image/png;base64,AAAA'],
  ])('ignores %s', (_label, value) => {
    rememberRecordedError(value)

    expect(listRecordedErrors()).toEqual([])
  })
})
