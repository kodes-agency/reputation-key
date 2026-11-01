// The detail page of the Google rating goal, worked out (2026-11-01, ADR 0067): the
// sentences under the headline (when the goal arrives at the card's own pace, and the
// other pace once the goal works at its actual one) and how fresh Google's numbers
// are. Every time is a duration, never a date.
import { describe, expect, it } from 'vitest'
import { detailHeaderLines, freshnessText } from './rating-goal-detail-view'
import {
  DETAIL_GOOGLE_SOURCE,
  DETAIL_HARBORLINE,
  DETAIL_LAGS,
  DETAIL_OLD_GOAL,
  DETAIL_TOO_LOW,
} from './rating-goal-detail.stories.fixtures'
import {
  DETAIL_BELOW_PACE,
  DETAIL_JUST_SET,
} from './rating-goal-detail-states.stories.fixtures'
import {
  DETAIL_FOUND_ENDED,
  DETAIL_FOUND_REACHED,
} from './rating-goal-detail-outcomes.stories.fixtures'
import { CARD_ACTUAL_PACE } from './rating-goal-tracking.stories.fixtures'

describe('the header’s sentences', () => {
  it('says when the goal arrives at the card’s pace, and the range it is likely in', () => {
    expect(detailHeaderLines(DETAIL_HARBORLINE)).toEqual({
      arrival: '4.1 in about 3 weeks at your 1 a day, likely 2–4 weeks.',
      otherPace: null,
    })
  })

  it('says it at the plan while the goal is new, in the setup’s own words', () => {
    expect(detailHeaderLines(DETAIL_JUST_SET).arrival).toBe(
      '4.1 in about 3 months at your 1 a day, likely 9 weeks to 4 months.',
    )
  })

  it('gives the chosen pace’s time too once the goal works at its actual pace', () => {
    const lines = detailHeaderLines({
      ...DETAIL_HARBORLINE,
      ...CARD_ACTUAL_PACE,
      // 27 in the last 28 days against 1 a day: the times read alike.
      forecastAtChosenPace: {
        kind: 'days',
        central: { num: 63, den: 1 },
        fast: { num: 50, den: 1 },
        slow: null,
      },
    })

    expect(lines.arrival).toBe(
      '4.1 in about 3 weeks at your pace of the last 4 weeks, likely 2–4 weeks.',
    )
    expect(lines.otherPace).toBe('At your 1 a day: in about 9 weeks.')
    expect(
      detailHeaderLines({ ...DETAIL_HARBORLINE, ...CARD_ACTUAL_PACE }).otherPace,
    ).toBeNull()
  })

  it('says both times for a goal behind its pace: the pace it has, and the one it chose', () => {
    expect(detailHeaderLines(DETAIL_BELOW_PACE)).toEqual({
      arrival: '4.1 in about 5 weeks at your pace of the last 4 weeks, likely 4–7 weeks.',
      otherPace: 'At your 1 a day: in about 3 weeks.',
    })
  })

  it('names a pace of more than a day with its decimal', () => {
    expect(detailHeaderLines(DETAIL_OLD_GOAL).otherPace).toBe(
      'At your 1.5 a day: in about 10 months.',
    )
  })

  it('says the same while RepKey lacks some of Google’s reviews, whose counts it marks elsewhere', () => {
    expect(detailHeaderLines(DETAIL_GOOGLE_SOURCE)).toEqual(
      detailHeaderLines(DETAIL_HARBORLINE),
    )
  })

  it('gives no time while Google should show the goal soon or new reviews are too low', () => {
    expect(detailHeaderLines(DETAIL_LAGS)).toEqual({ arrival: null, otherPace: null })
    expect(detailHeaderLines(DETAIL_TOO_LOW)).toEqual({ arrival: null, otherPace: null })
  })

  it('gives no time while Google’s numbers are stale', () => {
    const stale = { ...DETAIL_HARBORLINE, status: 'waiting_for_google' as const }

    expect(detailHeaderLines(stale)).toEqual({ arrival: null, otherPace: null })
  })

  it('says nothing more of a goal the read found reached or ended', () => {
    const none = { arrival: null, otherPace: null }

    expect(detailHeaderLines(DETAIL_FOUND_REACHED)).toEqual(none)
    expect(detailHeaderLines(DETAIL_FOUND_ENDED)).toEqual(none)
    expect(detailHeaderLines({ ...DETAIL_HARBORLINE, state: 'reached' })).toEqual(none)
  })
})

describe('the foot', () => {
  it('says how long ago Google’s numbers were checked', () => {
    const readAt = new Date('2026-10-14T12:00:00.000Z')

    expect(freshnessText('2026-10-14T11:48:00.000Z', readAt)).toBe(
      'Google numbers checked 12 minutes ago',
    )
    expect(freshnessText('2026-10-14T11:59:40.000Z', readAt)).toBe(
      'Google numbers checked just now',
    )
    expect(freshnessText('2026-10-14T07:00:00.000Z', readAt)).toBe(
      'Google numbers checked 5 hours ago',
    )
    expect(freshnessText('2026-10-11T12:00:00.000Z', readAt)).toBe(
      'Google numbers checked 3 days ago',
    )
  })
})
