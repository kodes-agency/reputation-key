// The detail page of the Google rating goal, worked out: the forecasts at both
// paces and the best case, the bar from where the goal started to the line
// Google shows the target at with the next tenth marked, the three tiles, the
// star mix, the weekly chart's words and how fresh Google's numbers are.
import { describe, expect, it } from 'vitest'
import {
  aboutHowLong,
  bestCaseLine,
  cantReachSuggestion,
  detailForecasts,
  detailTiles,
  freshnessText,
  nextTenthLine,
  progressMarks,
  starMixSummary,
  weeklyCaption,
} from './rating-goal-detail-view'
import { DETAIL, SETUP, SETUP_KEEP_FIRST } from './rating-goal.stories.fixtures'

describe('how long a count of reviews takes', () => {
  it('says weeks, then months, then years', () => {
    expect(aboutHowLong(31, 11)).toBe('about 3 weeks')
    expect(aboutHowLong(207, 11)).toBe('about 4 months')
    expect(aboutHowLong(1300, 11)).toBe('about 2.3 years')
  })
})

describe('the forecasts', () => {
  it('forecasts at the chosen pace and at the pace of the last four weeks', () => {
    expect(detailForecasts(DETAIL)).toEqual([
      { label: 'At your chosen pace, 11 a week', text: 'Expected around Mar–Nov 2027' },
      {
        label: 'At your pace of the last 4 weeks, 9.5 a week',
        text: 'Expected around Jul–Sep 2027',
      },
    ])
  })

  it('says the best case quietly', () => {
    expect(bestCaseLine(DETAIL)).toBe(
      'If every new review is 5★: 97 more reviews, about 2 months at 11 a week.',
    )
    expect(bestCaseLine({ ...DETAIL, bestCase: null })).toBeNull()
  })
})

describe('the progress', () => {
  it('marks the next tenth on the way from the start to the line', () => {
    const marks = progressMarks(DETAIL)

    expect(marks.value).toBe(0.52)
    // 4.35 is two sevenths of the way from 4.31 to 4.45.
    expect(marks.marker).toBeCloseTo(0.2857, 3)
    expect(marks.start).toBe('Started at 4.31')
    expect(marks.end).toBe('4.45 shows 4.5')
  })

  it('marks nothing when the next tenth is the target itself', () => {
    expect(
      progressMarks({
        ...DETAIL,
        nextTenth: { targetTenths: 45, target: 4.5, reviewsNeeded: 212 },
      }).marker,
    ).toBeNull()
  })

  it('says how far the next tenth is', () => {
    expect(nextTenthLine(DETAIL)).toBe(
      'Next: Google shows 4.4 after about 31 more reviews',
    )
    expect(
      nextTenthLine({
        ...DETAIL,
        nextTenth: { targetTenths: 44, target: 4.4, reviewsNeeded: null },
      }),
    ).toBe('Next: Google shows 4.4 — not reachable at the recent star mix')
    expect(nextTenthLine({ ...DETAIL, nextTenth: null })).toBeNull()
  })
})

describe('the tiles', () => {
  it('counts this week, the last four weeks and what is still needed', () => {
    expect(detailTiles(DETAIL)).toEqual([
      { label: 'This week', value: '6 of 11', detail: 'new reviews since Monday' },
      { label: 'Last 4 weeks', value: '9.5 a week', detail: 'your pace is 11 a week' },
      {
        label: 'Still needed',
        value: '212 reviews',
        detail: 'best case 97, if every new review is 5★',
      },
    ])
  })

  it('says a target the mix does not reach is not reachable', () => {
    expect(detailTiles({ ...DETAIL, stillNeeded: null })[2]).toEqual({
      label: 'Still needed',
      value: 'Not reachable',
      detail: 'at the recent star mix',
    })
  })
})

describe('the rest of the page', () => {
  it('sums the stars of the reviews since the goal was set', () => {
    expect(starMixSummary(DETAIL.starsSinceSet)).toBe(
      '107 reviews since the goal was set · average 4.61★',
    )
    expect(starMixSummary([])).toBe('No new reviews since the goal was set.')
  })

  it('reads the weekly chart in one line', () => {
    expect(weeklyCaption(DETAIL.weeks, 11)).toBe(
      '107 new reviews in 11 weeks; the pace is 11 a week.',
    )
    expect(weeklyCaption(DETAIL.weeks, null)).toBe('107 new reviews in 11 weeks.')
  })

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

describe('the fix suggested when no pace reaches the target', () => {
  it('names the highest goal a pace reaches, from the setup read', () => {
    expect(cantReachSuggestion(4.8, SETUP)).toBe(
      'No pace reaches 4.8 at the recent star mix. The highest goal you can reach now is 4.7.',
    )
  })

  it('offers to keep what Google shows when no higher goal is reachable', () => {
    expect(cantReachSuggestion(4.9, { ...SETUP_KEEP_FIRST, google: SETUP.google })).toBe(
      'No pace reaches 4.9 at the recent star mix. You can keep 4.3 instead.',
    )
    expect(cantReachSuggestion(4.9, undefined)).toBe(
      'No pace reaches 4.9 at the recent star mix. A lower goal can still be reached.',
    )
  })
})
