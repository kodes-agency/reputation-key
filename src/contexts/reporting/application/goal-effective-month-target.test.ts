import { describe, expect, it } from 'vitest'
import { effectiveMonthTarget } from './goal-effective-month-target'

describe('effective month target', () => {
  it("uses the month's own target when it has one", () => {
    expect(effectiveMonthTarget({ targetValue: 300 }, { targetValue: 400 })).toBe(300)
  })

  it("uses the version's target when the month has none of its own", () => {
    expect(effectiveMonthTarget({ targetValue: null }, { targetValue: 400 })).toBe(400)
  })

  it("keeps a month's own target that is higher than the version's", () => {
    expect(effectiveMonthTarget({ targetValue: 4.6 }, { targetValue: 4.2 })).toBe(4.6)
  })
})
