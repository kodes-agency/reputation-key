import { describe, expect, it } from 'vitest'
import {
  AVERAGE_BELOW_MINIMUM_REASON,
  MIN_RATING_COMPARISON_SAMPLE,
  PORTAL_AVERAGE_MIN_SAMPLE,
  averageWithholdReason,
  isAverageShowable,
  isComparisonShowable,
} from './portal-results-thresholds'

describe('portal results thresholds', () => {
  it('pins the two floors as separate numbers', () => {
    expect(PORTAL_AVERAGE_MIN_SAMPLE).toBe(5)
    expect(MIN_RATING_COMPARISON_SAMPLE).toBe(10)
  })

  it('holds the average back below five private ratings', () => {
    expect(isAverageShowable(0)).toBe(false)
    expect(isAverageShowable(4)).toBe(false)
    expect(isAverageShowable(5)).toBe(true)
    expect(isAverageShowable(80)).toBe(true)
  })

  it('needs ten ratings in each period before a comparison is shown', () => {
    expect(isComparisonShowable(9, 12)).toBe(false)
    expect(isComparisonShowable(12, 9)).toBe(false)
    expect(isComparisonShowable(10, 10)).toBe(true)
  })

  it('names a reason only when some ratings exist but not enough to average', () => {
    expect(averageWithholdReason(0)).toBeNull()
    expect(averageWithholdReason(4)).toBe(AVERAGE_BELOW_MINIMUM_REASON)
    expect(averageWithholdReason(5)).toBeNull()
  })
})
