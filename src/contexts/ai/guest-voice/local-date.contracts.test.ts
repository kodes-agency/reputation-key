import { describe, expect, it } from 'vitest'
import { addDays } from './local-date.contracts'

describe('addDays', () => {
  it('moves across month, year and leap-day boundaries', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-01-01', 364)).toBe('2026-12-31')
  })

  it.each(['2026-02-30', '2026-13-01', 'x', '2026-1-01'])('throws for %s', (input) => {
    expect(() => addDays(input, 0)).toThrow(TypeError)
  })

  it('throws for a delta that is not a safe integer', () => {
    expect(() => addDays('2026-01-01', 1.5)).toThrow(TypeError)
  })
})
