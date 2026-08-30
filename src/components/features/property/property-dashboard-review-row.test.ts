// The property dashboard died on one bad date.
//
// `RecentReview.reviewedAt` is typed `Date`, which says nothing about what
// arrives at runtime: a null or unparsable provider timestamp deserializes
// across the server-function boundary as an Invalid Date, and
// `Intl.DateTimeFormat#format` throws RangeError on one. That threw during
// render, so the whole /properties/$id page went down instead of a single row
// losing its timestamp — the e2e error gate caught it as
// "RangeError: Invalid time value".
//
// These assert BOTH directions. A guard that swallowed every date would pass
// the degradation cases and silently delete the feature, so the valid-date
// case is what keeps the fix honest.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { RecentReview } from '#/contexts/dashboard/application/public-api'
import { ReviewRow } from './property-dashboard-review-row'

const review = (reviewedAt: Date): RecentReview =>
  ({
    id: 'review-1',
    rating: 4,
    snippet: 'Quiet room, quick check-in.',
    reviewedAt,
    replyStatus: 'none',
  }) as unknown as RecentReview

const renderRow = (reviewedAt: Date): string =>
  renderToStaticMarkup(createElement(ReviewRow, { review: review(reviewedAt) }))

describe('ReviewRow review date', () => {
  it('renders a real instant', () => {
    expect(renderRow(new Date('2026-03-14T00:00:00.000Z'))).toContain('Mar 14, 2026')
  })

  it('renders the row without throwing when the timestamp is unparsable', () => {
    expect(() => renderRow(new Date('not-a-date'))).not.toThrow()
  })

  it('keeps the rest of the row when the date is missing', () => {
    // Degrading beats failing: the reviewer's words and rating are the point of
    // the row, and they survive a date the provider never sent.
    const markup = renderRow(new Date(Number.NaN))

    expect(markup).toContain('Quiet room, quick check-in.')
    expect(markup).toContain('4')
  })

  it('omits the element rather than printing a broken value', () => {
    const markup = renderRow(new Date(Number.NaN))

    expect(markup).not.toMatch(/Invalid Date/i)
    expect(markup).not.toMatch(/NaN/i)
  })
})
