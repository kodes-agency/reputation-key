import { describe, expect, it } from 'vitest'
import { allTimeLabel } from './portal-results-window'

describe('retained Portal results label', () => {
  it('keeps All Time until guest facts start expiring in October 2028', () => {
    expect(allTimeLabel(new Date('2028-09-30T23:59:59.999Z'))).toBe('All time')
    expect(allTimeLabel(new Date('2028-10-01T00:00:00.000Z'))).toBe('Last 24 months')
    expect(allTimeLabel(new Date('2029-02-01T00:00:00.000Z'))).toBe('Last 24 months')
  })
})
