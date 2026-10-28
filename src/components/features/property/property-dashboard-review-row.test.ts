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
//
// The row itself is a router link now (the five latest reviews are the things a
// manager most wants to open), so the guard is exercised here as the pure
// function it is; `property-overview.stories.tsx` renders a row with an
// unparsable date under a real router to prove the render path.

import { describe, expect, it } from 'vitest'
import { inboxItemId } from '#/shared/domain/ids'
import { formatReviewedAt, reviewRowSearch } from './property-dashboard-review-row'

describe('ReviewRow review date', () => {
  it('formats a real instant', () => {
    expect(formatReviewedAt(new Date('2026-03-14T00:00:00.000Z'))).toBe('Mar 14, 2026')
  })

  it('returns nothing rather than throwing on an unparsable timestamp', () => {
    expect(() => formatReviewedAt(new Date('not-a-date'))).not.toThrow()
    expect(formatReviewedAt(new Date('not-a-date'))).toBeNull()
  })

  it('returns nothing rather than printing a broken value', () => {
    // Null, not the string "Invalid Date": the row omits the element entirely.
    expect(formatReviewedAt(new Date(Number.NaN))).toBeNull()
  })
})

describe('ReviewRow link', () => {
  const PROPERTY_ID = '0b9d7c1a-3e5f-4b2a-8c6d-1e2f3a4b5c6d'
  const ITEM_ID = inboxItemId('7f1c2c9e-6c7b-4a0e-9d0e-2f6a3b1c4d5e')

  it('opens the review’s own Inbox item, by the key the Inbox reads', () => {
    expect(reviewRowSearch({ inboxItemId: ITEM_ID }, PROPERTY_ID)).toEqual({
      propertyId: PROPERTY_ID,
      itemId: ITEM_ID,
    })
  })

  it('never carries the review’s id: the Inbox ignores it and the row landed nowhere', () => {
    expect(Object.keys(reviewRowSearch({ inboxItemId: ITEM_ID }, PROPERTY_ID))).toEqual([
      'propertyId',
      'itemId',
    ])
  })

  it.each([
    ['a reader with no item for it', { inboxItemId: null }],
    ['a read that did not look', {}],
  ])('opens the Property’s Inbox for %s', (_name, review) => {
    expect(reviewRowSearch(review, PROPERTY_ID)).toEqual({ propertyId: PROPERTY_ID })
  })
})
