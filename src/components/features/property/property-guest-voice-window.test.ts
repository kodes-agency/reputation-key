import { describe, expect, it } from 'vitest'
import { LARGE_PROPERTY, SMALL_PROPERTY } from './property-guest-voice-stories-data'
import { windowDates, windowStatement } from './property-guest-voice-window'

describe('windowStatement', () => {
  it('names the window an automatic choice made and the reviews that made it', () => {
    expect(windowStatement(LARGE_PROPERTY)).toBe(
      'Last 90 days, chosen because it holds 128 reviews with text.',
    )
  })

  it.each([
    [30, 'Last 30 days'],
    [90, 'Last 90 days'],
    [180, 'Last 6 months'],
  ] as const)('words the %s-day window as "%s"', (range, words) => {
    expect(
      windowStatement({
        ...LARGE_PROPERTY,
        range,
        window: { selection: 'automatic', textReviewCount: 61, enoughForPatterns: true },
      }),
    ).toBe(`${words}, chosen because it holds 61 reviews with text.`)
  })

  it('says why 12 months is the window for a small property: no shorter one is enough', () => {
    expect(windowStatement(SMALL_PROPERTY)).toBe(
      'Last 12 months, chosen because no shorter period holds enough reviews with text. It holds 36.',
    )
  })

  it('says there are too few to spot patterns when even 12 months hold under ten', () => {
    expect(
      windowStatement({
        ...SMALL_PROPERTY,
        window: { selection: 'automatic', textReviewCount: 6, enoughForPatterns: false },
      }),
    ).toBe('Last 12 months. It holds 6 reviews with text, too few to spot patterns.')
    expect(
      windowStatement({
        ...SMALL_PROPERTY,
        window: { selection: 'automatic', textReviewCount: 0, enoughForPatterns: false },
      }),
    ).toBe('Last 12 months. It holds no reviews with text, too few to spot patterns.')
  })

  it('states a window the reader chose without claiming it was chosen for them', () => {
    expect(
      windowStatement({
        ...LARGE_PROPERTY,
        range: 30,
        window: { selection: 'chosen', textReviewCount: 41 },
      }),
    ).toBe('Last 30 days. It holds 41 reviews with text.')
    expect(
      windowStatement({
        ...LARGE_PROPERTY,
        window: { selection: 'chosen', textReviewCount: 1 },
      }),
    ).toBe('Last 90 days. It holds 1 review with text.')
  })

  it('says since when All time starts', () => {
    expect(
      windowStatement({
        ...LARGE_PROPERTY,
        range: 'all',
        startLocalDate: '2025-06-25',
        windowStartBasis: 'earliest_evidence',
        window: { selection: 'chosen', textReviewCount: 304 },
      }),
    ).toBe('All time, since Jun 25, 2025. It holds 304 reviews with text.')
  })
})

describe('windowDates', () => {
  it('gives the days the window covers, the ones a drill-down opens', () => {
    expect(windowDates(LARGE_PROPERTY)).toBe('Jun 13, 2026 to Sep 10, 2026')
  })
})
