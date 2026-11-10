import { describe, expect, it } from 'vitest'
import { allTimeLabel } from './portal-results-window'

describe('retained Portal results label', () => {
  it('keeps All time while retention is inactive, regardless of the calendar', () => {
    expect(allTimeLabel(false)).toBe('All time')
  })

  it('names the retained window only when retention is active', () => {
    expect(allTimeLabel(true)).toBe('Last 24 months')
  })
})
