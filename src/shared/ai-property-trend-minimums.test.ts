import { describe, expect, it } from 'vitest'
import {
  AI_PROPERTY_TREND_MINIMUM_ANALYZED_PER_WINDOW as FROM_CONTRACT,
  AI_PROPERTY_TREND_MINIMUM_COVERAGE_BASIS_POINTS as COVERAGE_FROM_CONTRACT,
} from './ai-property-trend-contract'
import {
  AI_PROPERTY_TREND_MINIMUM_ANALYZED_PER_WINDOW,
  AI_PROPERTY_TREND_MINIMUM_COVERAGE_BASIS_POINTS,
  trendWindowIsIncomplete,
} from './ai-property-trend-minimums'

describe('trend minimums', () => {
  it('are the numbers the trend contract enforces', () => {
    expect(AI_PROPERTY_TREND_MINIMUM_ANALYZED_PER_WINDOW).toBe(FROM_CONTRACT)
    expect(AI_PROPERTY_TREND_MINIMUM_COVERAGE_BASIS_POINTS).toBe(COVERAGE_FROM_CONTRACT)
    expect(FROM_CONTRACT).toBe(20)
    expect(COVERAGE_FROM_CONTRACT).toBe(9_000)
  })
})

describe('trendWindowIsIncomplete', () => {
  it('is incomplete while reviews with text are waiting to be analysed', () => {
    expect(
      trendWindowIsIncomplete({ textCandidateCount: 23, coverageBasisPoints: 8_695 }),
    ).toBe(true)
  })

  it('is complete at the minimum coverage and above it', () => {
    expect(
      trendWindowIsIncomplete({ textCandidateCount: 10, coverageBasisPoints: 9_000 }),
    ).toBe(false)
    expect(
      trendWindowIsIncomplete({ textCandidateCount: 20, coverageBasisPoints: 10_000 }),
    ).toBe(false)
  })

  it('is complete when the window holds no text review, whatever its stored coverage', () => {
    // 0 analysed of 0 is stored as 0 basis points; there is nothing to wait for.
    expect(
      trendWindowIsIncomplete({ textCandidateCount: 0, coverageBasisPoints: 0 }),
    ).toBe(false)
  })
})
