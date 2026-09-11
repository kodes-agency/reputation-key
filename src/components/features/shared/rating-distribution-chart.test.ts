import { describe, expect, it } from 'vitest'
import { buildRatingDistributionData } from './rating-distribution-chart'

describe('buildRatingDistributionData', () => {
  it('normalizes every star bucket in descending order with its count and percentage', () => {
    expect(
      buildRatingDistributionData([
        { stars: 1, count: 1 },
        { stars: 5, count: 5 },
        { stars: 3, count: 2 },
        { stars: 5, count: 2 },
      ]),
    ).toEqual([
      { stars: 5, label: '5★', count: 7, percentage: 70, detail: '7 · 70%' },
      { stars: 4, label: '4★', count: 0, percentage: 0, detail: '0 · 0%' },
      { stars: 3, label: '3★', count: 2, percentage: 20, detail: '2 · 20%' },
      { stars: 2, label: '2★', count: 0, percentage: 0, detail: '0 · 0%' },
      { stars: 1, label: '1★', count: 1, percentage: 10, detail: '1 · 10%' },
    ])
  })

  it('uses one decimal when whole percentages would hide a small bucket', () => {
    const data = buildRatingDistributionData([
      { stars: 5, count: 2 },
      { stars: 4, count: 1 },
    ])

    expect(data[0]).toMatchObject({ percentage: 66.7, detail: '2 · 66.7%' })
    expect(data[1]).toMatchObject({ percentage: 33.3, detail: '1 · 33.3%' })
  })
})
