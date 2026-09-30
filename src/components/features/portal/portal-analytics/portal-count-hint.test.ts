import { describe, expect, it } from 'vitest'
import { countComparisonHint } from './portal-count-hint'

describe('countComparisonHint', () => {
  it('states the trend together with the absolute prior figure', () => {
    expect(countComparisonHint({ trend: 50, priorValue: 40 })).toBe('↑ 50% · prior 40')
    expect(countComparisonHint({ trend: -25, priorValue: 1200 })).toBe(
      '↓ 25% · prior 1,200',
    )
    expect(countComparisonHint({ trend: 0, priorValue: 7 })).toBe('— 0% · prior 7')
  })

  it('states only the prior figure when a percentage over it is meaningless', () => {
    expect(countComparisonHint({ trend: null, priorValue: 0 })).toBe('Prior period: 0')
  })

  it('says the prior window predates a measure that was not yet counted', () => {
    expect(
      countComparisonHint({
        trend: null,
        priorValue: null,
        priorUnavailableReason: 'measure_not_yet_counted',
      }),
    ).toBe('Prior period predates this measure')
  })

  it('states nothing when there is no prior figure to compare with', () => {
    expect(countComparisonHint({ trend: null, priorValue: null })).toBe('—')
  })
})
