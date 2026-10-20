import { describe, expect, it } from 'vitest'
import type { GoalListProgress } from '#/contexts/reporting/application/public-api'
import { GOAL_PACE_STATUS } from './goal-pace-status'
import {
  daysLeftWords,
  goalListSummary,
  goalLiveShape,
  goalLiveView,
} from './goal-live-view'

const goal = (patch: Partial<GoalListProgress> = {}): GoalListProgress => ({
  programId: 'program-1',
  metric: 'qualified_scans',
  subjectCount: 1,
  daysLeft: 14,
  month: {
    reading: { kind: 'live', value: 64, sampleCount: 64 },
    targetValue: 120,
  },
  belowPace: null,
  ...patch,
})

describe('the live line of a goal with one count subject', () => {
  it('says the figure of the target so far and the days left, with a neutral bar', () => {
    const line = goalLiveView(goal())

    expect(line).toEqual({
      text: '64 of 120 so far · 15 days left',
      pace: null,
      bar: {
        value: 64,
        max: 120,
        label: 'Scans so far this month',
        valueText: '64 of 120 so far',
      },
    })
  })

  it('prints thousands the way every other count does', () => {
    const line = goalLiveView(
      goal({
        metric: 'portal_rating_count',
        month: {
          reading: { kind: 'live', value: 1234, sampleCount: 1234 },
          targetValue: 2500,
        },
      }),
    )

    expect(line?.text).toBe('1,234 of 2,500 so far · 15 days left')
    expect(line?.bar?.label).toBe('Private ratings so far this month')
  })

  it('does not call a count past its target anything but a count so far', () => {
    const line = goalLiveView(
      goal({
        month: {
          reading: { kind: 'live', value: 150, sampleCount: 150 },
          targetValue: 120,
        },
      }),
    )

    expect(line?.text).toBe('150 of 120 so far · 15 days left')
    expect(line?.bar).toMatchObject({ value: 150, max: 120 })
  })

  it('counts a month with nothing yet as zero, not as missing', () => {
    const line = goalLiveView(
      goal({
        month: {
          reading: { kind: 'live', value: 0, sampleCount: 0 },
          targetValue: 120,
        },
      }),
    )

    expect(line?.text).toBe('0 of 120 so far · 15 days left')
  })

  it.each([
    [1, '2 days left'],
    [0, 'last day'],
  ])('words %i days after today as "%s"', (daysLeft, words) => {
    expect(goalLiveView(goal({ daysLeft }))?.text).toBe(`64 of 120 so far · ${words}`)
  })

  it('says a figure that cannot be read so, with no bar and no zero', () => {
    const line = goalLiveView(
      goal({
        month: { reading: { kind: 'unavailable' }, targetValue: 120 },
      }),
    )

    expect(line).toEqual({
      text: 'This month’s figure can’t be read right now',
      pace: null,
      bar: null,
    })
  })
})

describe('the pace pill of a goal with one count subject', () => {
  const paced = (belowPace: number | null, patch: Partial<GoalListProgress> = {}) =>
    goalLiveView(goal({ belowPace, ...patch }))

  it('is "Below pace" for a count behind, after the figure and the days left, and keeps the bar', () => {
    expect(paced(1)).toEqual({
      text: '64 of 120 so far · 15 days left',
      pace: GOAL_PACE_STATUS.below_pace,
      bar: {
        value: 64,
        max: 120,
        label: 'Scans so far this month',
        valueText: '64 of 120 so far',
      },
    })
  })

  it('is the shared pill: the same words and tone the card and the page wear', () => {
    expect(paced(1)?.pace).toEqual({ label: 'Below pace', tone: 'warn' })
    expect(paced(0)?.pace).toEqual({ label: 'On pace', tone: 'positive' })
  })

  it('is "Below pace" for any number of subjects behind that is at least one', () => {
    expect(paced(2)?.pace).toBe(GOAL_PACE_STATUS.below_pace)
  })

  it('is "On pace" for a count that keeps up', () => {
    expect(paced(0)).toMatchObject({
      text: '64 of 120 so far · 15 days left',
      pace: GOAL_PACE_STATUS.on_pace,
    })
  })

  it('says it on the last day too', () => {
    expect(paced(1, { daysLeft: 0 })).toMatchObject({
      text: '64 of 120 so far · last day',
      pace: GOAL_PACE_STATUS.below_pace,
    })
    expect(paced(0, { daysLeft: 0 })?.pace).toBe(GOAL_PACE_STATUS.on_pace)
  })

  it('says nothing when the pace was not judged: an early month, too few expected', () => {
    expect(paced(null)?.pace).toBeNull()
  })

  it('never puts the verdict in the words, so the sentence reads the same with or without it', () => {
    const texts = [paced(1), paced(0), paced(null)].map((line) => line?.text)

    expect(new Set(texts)).toEqual(new Set(['64 of 120 so far · 15 days left']))
  })

  it('adds nothing to a figure that cannot be read, whatever the pace says', () => {
    const line = paced(1, {
      month: { reading: { kind: 'unavailable' }, targetValue: 120 },
    })

    expect(line).toEqual({
      text: 'This month’s figure can’t be read right now',
      pace: null,
      bar: null,
    })
  })

  it('adds nothing to an average, which has no pace', () => {
    const line = paced(1, {
      metric: 'portal_rating_average',
      month: {
        reading: { kind: 'live', value: 3.2, sampleCount: 31 },
        targetValue: 4.5,
      },
    })

    expect(line?.pace).toBeNull()
  })
})

describe('the live line of a goal with one average subject', () => {
  const average = (reading: NonNullable<GoalListProgress['month']>['reading']) =>
    goal({
      metric: 'portal_rating_average',
      month: { reading, targetValue: 4.5 },
    })

  it('says the average so far against the target, with the days left and no bar', () => {
    const line = goalLiveView(average({ kind: 'live', value: 4.62, sampleCount: 31 }))

    expect(line).toEqual({
      text: '4.6 so far · target 4.5 · 15 days left',
      pace: null,
      bar: null,
    })
  })

  it('asks for more ratings below the measure’s minimum sample, never an average', () => {
    const line = goalLiveView(
      average({ kind: 'too_few', sampleCount: 4, minimumSample: 10 }),
    )

    expect(line).toEqual({
      text: 'More ratings needed · 4 of 10 so far · target 4.5 · 15 days left',
      pace: null,
      bar: null,
    })
  })

  it('says an average that cannot be read so', () => {
    expect(goalLiveView(average({ kind: 'unavailable' }))).toEqual({
      text: 'This month’s figure can’t be read right now',
      pace: null,
      bar: null,
    })
  })
})

describe('the live line of a goal with several subjects', () => {
  const several = (patch: Partial<GoalListProgress>) =>
    goal({ subjectCount: 3, month: null, ...patch })

  it('counts the subjects below pace on a count', () => {
    expect(goalLiveView(several({ belowPace: 2 }))).toEqual({
      text: '3 subjects · 2 below pace',
      pace: null,
      bar: null,
    })
    expect(goalLiveView(several({ belowPace: 1 }))?.text).toBe(
      '3 subjects · 1 below pace',
    )
  })

  it('says none are below pace when every subject keeps up', () => {
    expect(goalLiveView(several({ belowPace: 0 }))?.text).toBe(
      '3 subjects · none below pace',
    )
  })

  it('keeps the count as words and draws no pill, whatever the subjects are at', () => {
    // A pill is one pace, and a goal of several subjects has several (Q-7).
    for (const belowPace of [0, 1, 2, null]) {
      expect(goalLiveView(several({ belowPace }))?.pace).toBeNull()
    }
  })

  it('says only the subjects when nothing was judged: an average, an early month', () => {
    expect(goalLiveView(several({ belowPace: null }))).toEqual({
      text: '3 subjects',
      pace: null,
      bar: null,
    })
    expect(
      goalLiveView(several({ metric: 'portal_rating_average', belowPace: null }))?.text,
    ).toBe('3 subjects')
  })
})

describe('the days left in a month', () => {
  it('counts today as a day left: 9 on Nov 22', () => {
    // Nov 22 of a 30-day month: 8 whole days begin after today.
    expect(daysLeftWords(8)).toBe('9 days left')
  })

  it('the last day says last day', () => {
    expect(daysLeftWords(0)).toBe('last day')
  })

  it('says 2 days left the day before the last', () => {
    expect(daysLeftWords(1)).toBe('2 days left')
  })
})

describe('the quiet line of a row', () => {
  it('joins the measure, the target, the subjects and when it was set', () => {
    expect(goalListSummary(['Scans', 'target 120', 'Reception', 'set on Sep 20'])).toBe(
      'Scans · target 120 · Reception · set on Sep 20',
    )
  })

  it('leaves out what is not there, so no dot hangs on the end', () => {
    expect(goalListSummary(['Scans', 'target 120', null, null])).toBe(
      'Scans · target 120',
    )
    expect(goalListSummary(['Scans', 'target 120', null, 'set on Sep 20'])).toBe(
      'Scans · target 120 · set on Sep 20',
    )
  })
})

describe('the room a row keeps for its live line while the month is read', () => {
  const row = (patch: Partial<Parameters<typeof goalLiveShape>[0]> = {}) => ({
    status: 'active' as const,
    metric: 'qualified_scans' as const,
    subjectCount: 1,
    ...patch,
  })

  it('keeps a line and a bar for an active count with one subject', () => {
    expect(goalLiveShape(row())).toBe('line_and_bar')
    expect(goalLiveShape(row({ metric: 'portal_rating_count' }))).toBe('line_and_bar')
  })

  it('keeps a line alone for an average, which has no bar', () => {
    expect(goalLiveShape(row({ metric: 'portal_rating_average' }))).toBe('line')
  })

  it('keeps a line alone for a goal with several subjects, which has no bar', () => {
    expect(goalLiveShape(row({ subjectCount: 3 }))).toBe('line')
    expect(goalLiveShape(row({ subjectCount: 3, metric: 'portal_rating_average' }))).toBe(
      'line',
    )
  })

  it.each(['scheduled', 'paused', 'ended'] as const)(
    'keeps nothing for a %s goal, which has no live line',
    (status) => {
      expect(goalLiveShape(row({ status }))).toBeNull()
    },
  )

  it('keeps nothing for a goal with no subject to count', () => {
    expect(goalLiveShape(row({ subjectCount: 0 }))).toBeNull()
  })

  it('keeps what the line will use: a bar exactly where the live line draws one', () => {
    const counted = goal({ subjectCount: 1 })
    const several = goal({ subjectCount: 3, month: null, belowPace: 1 })
    const average = goal({
      metric: 'portal_rating_average',
      month: { reading: { kind: 'live', value: 4.6, sampleCount: 30 }, targetValue: 4.5 },
    })

    for (const [live, shape] of [
      [counted, goalLiveShape(row())],
      [several, goalLiveShape(row({ subjectCount: 3 }))],
      [average, goalLiveShape(row({ metric: 'portal_rating_average' }))],
    ] as const) {
      expect(shape === 'line_and_bar').toBe(goalLiveView(live)?.bar != null)
    }
  })
})
