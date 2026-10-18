import { describe, expect, it } from 'vitest'
import type {
  PortalGoalLastMonth,
  PortalGoalRows,
  PortalGoalRunningMonth,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import {
  lastMonthWords,
  portalCountsWords,
  runningWords,
  stoppedWords,
} from './portal-goal-running-view'

/** G10, Nov 22: 23 of 40, 22 of 30 days gone, behind. */
const month = (patch: Partial<PortalGoalRunningMonth> = {}): PortalGoalRunningMonth => ({
  key: '2026-11',
  target: 40,
  value: 23,
  elapsedDays: 22,
  totalDays: 30,
  daysAfterToday: 8,
  belowPace: true,
  quietDays: false,
  ...patch,
})

const figureOf = (words: ReturnType<typeof runningWords>) => {
  if (words.kind !== 'figure') throw new Error('expected a figure')
  return words
}

describe('the running Monthly portal goal, in words', () => {
  it('23 of 40 · 17 to go · 9 days left on Nov 22', () => {
    const words = figureOf(runningWords(month(), 'portal_rating_count'))

    expect(words.figure).toBe('23 of 40')
    expect(words.unit).toBe('private ratings')
    expect(words.line).toBe('17 to go · 9 days left')
    expect(words.pace).toBe('below pace')
    expect(words.bar).toEqual({
      value: 23,
      max: 40,
      tick: 22 / 30,
      label: 'Private ratings in November',
      valueText: '23 of 40 private ratings, 9 days left, below pace',
    })
  })

  it('never says on pace', () => {
    const words = figureOf(runningWords(month({ belowPace: false }), 'qualified_scans'))

    expect(words.pace).toBeNull()
    expect(words.unit).toBe('scans')
    expect(words.bar.label).toBe('Scans in November')
    expect(words.bar.valueText).toBe('23 of 40 scans, 9 days left')
  })

  it('no pace word in the quiet days', () => {
    // Nov 2: the first days are never judged, and the bar has no tick yet.
    const words = figureOf(
      runningWords(
        month({
          value: 1,
          elapsedDays: 2,
          daysAfterToday: 28,
          belowPace: null,
          quietDays: true,
        }),
        'portal_rating_count',
      ),
    )

    expect(words.pace).toBeNull()
    expect(words.line).toBe('39 to go · 29 days left')
    expect(words.bar.tick).toBeNull()
  })

  it('fewer than 5 expected: no pace word, and the tick still shows the day', () => {
    const words = figureOf(
      runningWords(
        month({ target: 10, value: 0, elapsedDays: 14, belowPace: null }),
        'portal_rating_count',
      ),
    )

    expect(words.pace).toBeNull()
    expect(words.bar.tick).toBe(14 / 30)
  })

  it('Goal passed · 4 days left, no tick, full bar', () => {
    // G18: 41 of 40 on Nov 27.
    const words = figureOf(
      runningWords(
        month({ value: 41, elapsedDays: 27, daysAfterToday: 3, belowPace: false }),
        'portal_rating_count',
      ),
    )

    expect(words.figure).toBe('41 of 40')
    expect(words.line).toBe('Goal passed · 4 days left')
    expect(words.passed).toBe(true)
    expect(words.bar).toMatchObject({ value: 41, max: 40, tick: null })
    expect(words.bar.valueText).toBe('41 of 40 private ratings, goal passed, 4 days left')
  })

  it('last day', () => {
    const words = figureOf(
      runningWords(
        month({ elapsedDays: 30, daysAfterToday: 0, belowPace: true }),
        'portal_rating_count',
      ),
    )

    expect(words.line).toBe('17 to go · last day')
    expect(words.bar.valueText).toBe('23 of 40 private ratings, last day, below pace')
  })

  it('counts in the target: one is singular', () => {
    const words = figureOf(
      runningWords(
        month({ target: 1, value: 0, belowPace: null }),
        'portal_rating_count',
      ),
    )

    expect(`${words.figure} ${words.unit}`).toBe('0 of 1 private rating')
  })

  it('unreadable shows no bar and no zero', () => {
    const words = runningWords(
      month({ value: null, target: 45, belowPace: null }),
      'portal_rating_count',
    )

    expect(words).toEqual({
      kind: 'unreadable',
      heading: 'November · 45 private ratings',
      line: 'This month’s figure can’t be read right now.',
    })
  })

  it('valueText names pace and days', () => {
    const bar = (patch: Partial<PortalGoalRunningMonth>) =>
      figureOf(runningWords(month(patch), 'portal_rating_count')).bar.valueText

    expect(bar({})).toBe('23 of 40 private ratings, 9 days left, below pace')
    expect(bar({ belowPace: null })).toBe('23 of 40 private ratings, 9 days left')
    expect(bar({ daysAfterToday: 1, belowPace: false })).toBe(
      '23 of 40 private ratings, 2 days left',
    )
  })
})

describe('what each portal brought in, in words', () => {
  const rows = (patch: Partial<Extract<PortalGoalRows, { kind: 'rows' }>> = {}) =>
    ({
      kind: 'rows',
      portals: [
        { portalId: 'portal-reception', name: 'Reception', count: 3 },
        { portalId: 'portal-restaurant', name: 'Restaurant', count: 0 },
        { portalId: 'portal-spa', name: 'Spa', count: 20 },
      ],
      elsewhere: 0,
      ...patch,
    }) satisfies PortalGoalRows

  it("rows stay in the read's name order", () => {
    // Spa has the most and Reception the fewest: the order is the read's.
    expect(portalCountsWords(rows())).toEqual({
      kind: 'rows',
      heading: 'From your portals',
      rows: [
        { key: 'portal-reception', name: 'Reception', count: '3' },
        { key: 'portal-restaurant', name: 'Restaurant', count: '0' },
        { key: 'portal-spa', name: 'Spa', count: '20' },
      ],
    })
  })

  it('Other portals only when something came from them', () => {
    const words = portalCountsWords(rows({ elsewhere: 2 }))

    expect(words.kind === 'rows' ? words.rows.map(({ name }) => name) : []).toEqual([
      'Reception',
      'Restaurant',
      'Spa',
      'Other portals',
    ])
    expect(words.kind === 'rows' ? words.rows.at(-1) : null).toEqual({
      key: 'elsewhere',
      name: 'Other portals',
      count: '2',
    })
  })

  it('one portal: All from Reception.', () => {
    expect(portalCountsWords({ kind: 'one', name: 'Reception' })).toEqual({
      kind: 'sentence',
      text: 'All from Reception.',
    })
  })

  it('five portals: From 5 portals', () => {
    // "See each" comes with the goal page it opens (PG-13).
    expect(portalCountsWords({ kind: 'many', count: 5 })).toEqual({
      kind: 'sentence',
      text: 'From 5 portals',
    })
  })
})

describe('a stopped goal and the month before, in words', () => {
  it('a stopped goal says the day it was stopped, and the day its month counts to', () => {
    expect(stoppedWords({ on: '2026-11-12', monthEnd: '2026-11-30' }, '2026-11')).toBe(
      'Stopped on Nov 12. November still counts to Nov 30.',
    )
    // Stopped before the day was recorded.
    expect(stoppedWords({ on: null, monthEnd: '2026-11-30' }, '2026-11')).toBe(
      'Stopped. November still counts to Nov 30.',
    )
  })

  const last = (patch: Partial<PortalGoalLastMonth>): PortalGoalLastMonth => ({
    key: '2026-11',
    value: 36,
    target: 40,
    outcome: 'updating',
    finalOn: '2026-12-02',
    ...patch,
  })

  it('the month before is counting its last readings until its final figure', () => {
    expect(lastMonthWords(last({}), 'portal_rating_count')).toEqual({
      text: 'November: counting the last ratings. Final figure on Dec 2.',
      met: false,
    })
    expect(lastMonthWords(last({}), 'qualified_scans')?.text).toBe(
      'November: counting the last scans. Final figure on Dec 2.',
    )
  })

  it('then met, or not met in neutral words', () => {
    expect(
      lastMonthWords(last({ value: 41, outcome: 'met' }), 'portal_rating_count'),
    ).toEqual({ text: 'November met: 41 of 40', met: true })
    expect(lastMonthWords(last({ outcome: 'not_met' }), 'portal_rating_count')).toEqual({
      text: 'November: 36 of 40 · not met',
      met: false,
    })
  })

  it('says nothing of a month with no usable result', () => {
    expect(
      lastMonthWords(
        last({ value: null, outcome: 'unavailable' }),
        'portal_rating_count',
      ),
    ).toBeNull()
  })
})
