import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  buildRatingDistributionData,
  RatingDistributionChart,
} from './rating-distribution-chart'

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

describe('RatingDistributionChart', () => {
  const render = (props: Partial<Parameters<typeof RatingDistributionChart>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(RatingDistributionChart, {
        distribution: [
          { stars: 5, count: 3 },
          { stars: 4, count: 1 },
        ],
        labelledBy: 'title',
        ...props,
      }),
    )

  it('counts ratings unless it is told it counts Google reviews', () => {
    expect(render()).toContain('3 of 4 ratings are 5★ (75%).')
    expect(render({ noun: 'reviews' })).toContain('3 of 4 reviews are 5★ (75%).')
    expect(render({ noun: 'reviews', distribution: [] })).toContain(
      'No reviews in this period.',
    )
  })
})
