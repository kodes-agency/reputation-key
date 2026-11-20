import { describe, expect, it } from 'vitest'
import {
  fillGuestTemplate,
  formatGuestPlural,
  templatePlaceholders,
} from './guest-copy-format'

describe('templatePlaceholders', () => {
  it('lists each placeholder once, in order of first use', () => {
    expect(templatePlaceholders('{name} and {word}, then {name} again')).toEqual([
      'name',
      'word',
    ])
    expect(templatePlaceholders('No placeholders here.')).toEqual([])
  })
})

describe('fillGuestTemplate', () => {
  it('replaces every occurrence of a placeholder', () => {
    expect(fillGuestTemplate('{a}-{b}-{a}', { a: 'x', b: 2 })).toBe('x-2-x')
  })

  it('keeps braces and dollar signs in a value literal', () => {
    expect(fillGuestTemplate('Hello {name}', { name: '$& {name} $1' })).toBe(
      'Hello $& {name} $1',
    )
  })

  it('throws when a value is missing instead of printing a raw placeholder', () => {
    expect(() => fillGuestTemplate('Until {time}, {zone}', { time: '15:32' })).toThrow(
      'Missing value for guest copy placeholder {zone}',
    )
  })
})

describe('formatGuestPlural', () => {
  const stars = { one: '{count} star', other: '{count} stars' }

  it.each([
    ['en', 1, '1 star'],
    ['en', 2, '2 stars'],
    ['en', 5, '5 stars'],
    ['bg', 1, '1 star'],
    ['bg', 2, '2 stars'],
    ['bg', 5, '5 stars'],
    ['de', 1, '1 star'],
    ['de', 2, '2 stars'],
    ['de', 5, '5 stars'],
  ])('picks the %s form for %i', (locale, count, expected) => {
    expect(formatGuestPlural(stars, count, locale)).toBe(expected)
  })

  it('uses the few and many forms a language defines, and falls back to other', () => {
    const forms = {
      one: '{count} jeden',
      few: '{count} kilka',
      many: '{count} wiele',
      other: '{count} inne',
    }
    expect(formatGuestPlural(forms, 1, 'pl')).toBe('1 jeden')
    expect(formatGuestPlural(forms, 3, 'pl')).toBe('3 kilka')
    expect(formatGuestPlural(forms, 5, 'pl')).toBe('5 wiele')
    // Only `one` and `other` are written: `few` falls back to `other`.
    expect(formatGuestPlural(stars, 3, 'pl')).toBe('3 stars')
  })
})
