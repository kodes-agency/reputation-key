import { describe, expect, it } from 'vitest'
import { ifNoneMatchMatches } from './conditional-get'

describe('ifNoneMatchMatches', () => {
  it.each([
    ['"a"', true],
    ['W/"a"', true],
    ['"b", "a"', true],
    ['*', true],
    ['"b"', false],
    ['', false],
    [null, false],
    [undefined, false],
  ])('%j against "a" is %s', (header, expected) => {
    expect(ifNoneMatchMatches(header, '"a"')).toBe(expected)
  })
})
