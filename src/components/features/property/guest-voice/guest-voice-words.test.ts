import { describe, expect, it } from 'vitest'
import type { ReviewTopicV3 } from '#/contexts/ai/application/public-api'
import {
  monthLabel,
  reviewDay,
  reviewsPhrase,
  topicLabel,
  windowDates,
  windowSentence,
} from './guest-voice-words'

const TOPICS: readonly ReviewTopicV3[] = [
  'staff_service',
  'speed_waiting',
  'booking_arrival',
  'main_service',
  'food_drink',
  'cleanliness',
  'facilities_equipment',
  'price_billing',
  'atmosphere_noise',
  'location_access',
  'safety',
  'communication',
]

describe('topic and reason words', () => {
  it('labels each of the twelve topics once, in sentence case', () => {
    const labels = TOPICS.map(topicLabel)

    expect(new Set(labels).size).toBe(12)
    expect(labels).toContain('Facilities and equipment')
    expect(labels).toContain('The main service')
    for (const label of labels) expect(label).toMatch(/^[A-Z][^A-Z]*$/u)
  })
})

describe('counts and averages', () => {
  it('counts a review in the singular and groups thousands', () => {
    expect(reviewsPhrase(1)).toBe('1 review')
    expect(reviewsPhrase(0)).toBe('0 reviews')
    expect(reviewsPhrase(1234)).toBe('1,234 reviews')
  })
})

describe('windowSentence', () => {
  const base = {
    range: 'auto',
    window: '90d',
    textReviewCount: 128,
    starOnlyCount: 96,
  } as const

  it('names an automatic window and why it was chosen', () => {
    expect(windowSentence(base)).toBe(
      'Last 90 days, chosen because it holds 128 reviews with text (plus 96 without text).',
    )
  })

  it('leaves out the reviews without text when there are none', () => {
    expect(windowSentence({ ...base, starOnlyCount: 0 })).toBe(
      'Last 90 days, chosen because it holds 128 reviews with text.',
    )
  })

  it('says why the automatic window is the whole year when no shorter one holds enough', () => {
    expect(
      windowSentence({ ...base, window: '365d', textReviewCount: 36, starOnlyCount: 14 }),
    ).toBe(
      'Last 12 months, chosen because no shorter period holds enough reviews with text. It holds 36 reviews with text (plus 14 without text).',
    )
  })

  it('is plain "chosen because" when the year itself holds enough', () => {
    expect(
      windowSentence({ ...base, window: '365d', textReviewCount: 80, starOnlyCount: 0 }),
    ).toBe('Last 12 months, chosen because it holds 80 reviews with text.')
  })

  it('does not claim to have chosen a window the person chose', () => {
    expect(
      windowSentence({ ...base, range: '30d', window: '30d', textReviewCount: 40 }),
    ).toBe('Last 30 days. It holds 40 reviews with text (plus 96 without text).')
  })

  it('warns that a window the person chose can hold too few reviews to spot patterns', () => {
    expect(
      windowSentence({
        range: '30d',
        window: '30d',
        textReviewCount: 4,
        starOnlyCount: 0,
      }),
    ).toBe(
      'Last 30 days. It holds 4 reviews with text. That is too few to spot patterns.',
    )
    expect(
      windowSentence({
        range: '30d',
        window: '30d',
        textReviewCount: 0,
        starOnlyCount: 0,
      }),
    ).toBe(
      'Last 30 days. It holds no reviews with text. That is too few to spot patterns.',
    )
  })
})

describe('dates', () => {
  it('prints the days the window covers', () => {
    expect(windowDates('2026-07-31', '2026-10-29')).toBe('Jul 31 to Oct 29, 2026')
    expect(windowDates('bad', '2026-10-29')).toBeNull()
  })

  it('prints the day of a review given as a day or as an instant', () => {
    expect(reviewDay('2026-10-18')).toBe('Oct 18, 2026')
    expect(reviewDay('2026-10-18T21:30:00.000Z')).toBe('Oct 18, 2026')
    expect(reviewDay('not a date')).toBeNull()
  })

  it('names a series month for a bar and for a sentence', () => {
    expect(monthLabel('2026-10')).toEqual({ short: 'Oct', long: 'October 2026' })
    expect(monthLabel('2025-01')).toEqual({ short: 'Jan', long: 'January 2025' })
  })
})
