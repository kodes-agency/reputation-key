import { describe, expect, it } from 'vitest'
import { addDays } from './local-date.contracts'

describe('addDays', () => {
  it.each(['2026-02-30', '2026-13-01', '2026-00-10', '2026-1-1', 'x'])(
    'throws for %s',
    (value) => {
      expect(() => addDays(value, 0)).toThrow(TypeError)
    },
  )

  it('throws for a non-integer delta', () => {
    expect(() => addDays('2026-01-01', 1.5)).toThrow(TypeError)
  })

  it.each([
    ['2026-03-01', -1, '2026-02-28'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2026-01-01', -1, '2025-12-31'],
    ['2026-01-01', 364, '2026-12-31'],
  ])('moves %s by %i days to %s', (from, delta, expected) => {
    expect(addDays(from, delta)).toBe(expected)
  })
})
