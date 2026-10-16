// The detail page of the Google rating goal, worked out: "Your plan" against
// what happened since it was set, the forecasts at both paces and the best case, the bar from where the goal started to the line
// Google shows the target at with the next tenth marked, the three tiles, the
// star mix, the weekly chart's words and how fresh Google's numbers are.
import { describe, expect, it } from 'vitest'
import {
  aboutHowLong,
  bestCaseLine,
  detailForecasts,
  detailTiles,
  freshnessText,
  nextTenthLine,
  progressMarks,
  starMixSummary,
  weeklyCaption,
  yourPlanLines,
} from './rating-goal-detail-view'
import { DETAIL_BEFORE_TEN, DETAIL_TOO_LOW } from './rating-goal-plan.stories.fixtures'
import { assumedAverageWords } from './rating-goal-view'
import { DETAIL } from './rating-goal.stories.fixtures'

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
      { label: 'At your chosen pace, 1.6 a day', text: 'Expected around Mar–Nov 2027' },
      {
        label: 'At your pace of the last 4 weeks, 1.4 a day',
        text: 'Expected around Jul–Sep 2027',
      },
    ])
  })

  it('gives no forecast while new reviews are too low: the page says so once', () => {
    expect(detailForecasts({ ...DETAIL, status: 'reviews_too_low' })).toEqual([])
  })

  it('names the average the numbers assume: the plan’s, mixed with new reviews, or theirs', () => {
    expect(assumedAverageWords({ ...DETAIL_BEFORE_TEN, qualityBasis: 'planned' })).toBe(
      'at your plan’s 4.5★',
    )
    expect(assumedAverageWords(DETAIL_BEFORE_TEN)).toBe(
      'at your plan’s 4.5★ mixed with new reviews so far',
    )
    expect(assumedAverageWords(DETAIL)).toBe(
      'at your plan’s 4.7★ mixed with new reviews so far',
    )
    expect(assumedAverageWords(DETAIL_TOO_LOW)).toBe('at the new reviews’ average')
    expect(assumedAverageWords({ qualityBasis: null, quality: null })).toBe(
      'at the recent star mix',
    )
  })

  it('names the new reviews’ average when no pace reaches the target at it', () => {
    // Waiting for Google keeps the status from saying "New reviews too low",
    // so the forecasts say it, at the average they were worked out at.
    const waiting = {
      ...DETAIL_TOO_LOW,
      status: 'waiting_for_google' as const,
    }

    expect(detailForecasts(waiting).map((line) => line.text)).toEqual([
      'No pace reaches 4.0 at the new reviews’ average',
      'No pace reaches 4.0 at the new reviews’ average',
    ])
  })

  it('says the best case quietly', () => {
    expect(bestCaseLine(DETAIL)).toBe(
      'If every new review is 5★: 97 more reviews, about 2 months at 1.6 a day.',
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
        qualityBasis: 'since_set',
        nextTenth: { targetTenths: 44, target: 4.4, reviewsNeeded: null },
      }),
    ).toBe('Next: Google shows 4.4 — not reachable at the new reviews’ average')
    expect(nextTenthLine({ ...DETAIL, nextTenth: null })).toBeNull()
  })
})

describe('the tiles', () => {
  it('counts this week, the last four weeks and what is still needed', () => {
    expect(detailTiles(DETAIL)).toEqual([
      { label: 'This week', value: '6 of 11', detail: 'new reviews since Monday' },
      { label: 'Last 4 weeks', value: '1.4 a day', detail: 'your pace is 1.6 a day' },
      {
        label: 'Still needed',
        value: '212 reviews',
        detail: 'best case 97, if every new review is 5★',
      },
    ])
  })

  it('says a target the new reviews’ average does not reach is not reachable', () => {
    // Only new reviews too low for the target leave it out of reach: before the
    // tenth review the numbers never assume less than the target's minimum
    // quality (or a plan below it), and from it a blend with reviews that clear
    // the threshold clears it too (trackingMix).
    expect(
      detailTiles({ ...DETAIL, qualityBasis: 'since_set', stillNeeded: null })[2],
    ).toEqual({
      label: 'Still needed',
      value: 'Not reachable',
      detail: 'at the new reviews’ average',
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
    expect(weeklyCaption(DETAIL.weeks, 110)).toBe(
      '107 new reviews in 11 weeks; the plan is 1.6 a day.',
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

describe('your plan', () => {
  it('puts the goal, the new reviews’ average and the pace against the plan', () => {
    expect(yourPlanLines(DETAIL.plan!)).toEqual([
      { term: 'Google shows', value: '4.3 · goal 4.5', note: null },
      {
        term: 'New reviews average',
        value: '4.61★ · plan 4.7★',
        note: '107 reviews since the goal was set · forecasts use 4.62★, your plan mixed with them',
      },
      {
        term: 'Pace, last 4 weeks',
        value: '1.4 a day · plan 1.6 a day',
        note: 'About 11 a week · 50 a month',
      },
    ])
  })

  it('gives no average before ten reviews, but says the forecasts already mix them in', () => {
    expect(yourPlanLines(DETAIL_BEFORE_TEN.plan!)[1]).toEqual({
      term: 'New reviews average',
      value: 'after 10 reviews · plan 4.5★',
      note: '4 reviews since the goal was set · forecasts use 4.55★, your plan mixed with them',
    })
    expect(
      yourPlanLines({
        ...DETAIL_BEFORE_TEN.plan!,
        sinceSet: { reviewCount: 0, average: null, averageTenths: null },
        qualityBasis: 'planned',
        assumedAverage: 4.5,
      })[1]?.note,
    ).toBe('No new reviews since the goal was set')
  })

  it('says the forecasts use the new reviews’ own average while they are too low', () => {
    expect(yourPlanLines(DETAIL_TOO_LOW.plan!)[1]?.note).toBe(
      '12 reviews since the goal was set · forecasts use their average',
    )
  })

  it('shows an average at or below the threshold as it is, never rounded onto the target', () => {
    expect(yourPlanLines(DETAIL_TOO_LOW.plan!)[1]?.value).toBe('3.75★ · plan 4.5★')
    expect(
      yourPlanLines({
        ...DETAIL_TOO_LOW.plan!,
        sinceSet: { reviewCount: 20, average: 3.95, averageTenths: 40 },
      })[1]?.value,
    ).toBe('3.95★ · plan 4.5★')
  })

  it('says Google’s number is not known when it is missing', () => {
    expect(yourPlanLines({ ...DETAIL.plan!, googleShowsTenths: null })[0]?.value).toBe(
      'not known yet · goal 4.5',
    )
  })
})
