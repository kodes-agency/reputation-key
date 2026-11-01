import { describe, expect, it } from 'vitest'
import type {
  PortalGoalLastMonth,
  PortalGoalRunningMonth,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { lastMonthWords, runningWords, stoppedWords } from './portal-goal-running-view'

/** G10, Nov 22: 23 of 40, 22 of 30 days gone, behind. */
const month = (patch: Partial<PortalGoalRunningMonth> = {}): PortalGoalRunningMonth => ({
  key: '2026-11',
  measure: 'portal_rating_count',
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
    const words = figureOf(runningWords(month()))

    expect(words.figure).toBe('23 of 40')
    expect(words.line).toBe('17 to go · 9 days left')
    expect(words.passed).toBe(false)
  })

  it('leads with what is left: 17 private ratings to 40', () => {
    const words = figureOf(runningWords(month()))

    expect(words.headline).toEqual({
      kind: 'left',
      count: '17',
      words: 'private ratings to',
      target: '40',
    })
  })

  it('counts what is left in its own unit: one is singular, scans are scans', () => {
    const left = (patch: Partial<PortalGoalRunningMonth>) => {
      const words = figureOf(runningWords(month(patch)))
      if (words.headline.kind !== 'left') throw new Error('expected what is left')
      return `${words.headline.count} ${words.headline.words} ${words.headline.target}`
    }

    expect(left({ value: 39, belowPace: null })).toBe('1 private rating to 40')
    expect(left({ measure: 'qualified_scans', target: 55, value: 43 })).toBe(
      '12 scans to 55',
    )
    expect(left({ value: 0, target: 1 })).toBe('1 private rating to 1')
  })

  it('says a passed month in the unit of what it has: Goal passed: 43 private ratings', () => {
    const words = figureOf(
      runningWords(month({ value: 43, belowPace: false, daysAfterToday: 3 })),
    )

    expect(words.headline).toEqual({
      kind: 'passed',
      text: 'Goal passed: 43 private ratings',
    })
    expect(words.passed).toBe(true)
    expect(
      figureOf(runningWords(month({ value: 1, target: 1, belowPace: false }))).headline,
    ).toEqual({ kind: 'passed', text: 'Goal passed: 1 private rating' })
  })

  it('a scans month says scans in its headline', () => {
    const words = figureOf(
      runningWords(month({ belowPace: false, measure: 'qualified_scans' })),
    )

    expect(words.headline).toMatchObject({ words: 'scans to' })
  })

  it('Goal passed · 4 days left on Nov 27, 41 of 40', () => {
    // G18.
    const words = figureOf(
      runningWords(
        month({ value: 41, elapsedDays: 27, daysAfterToday: 3, belowPace: false }),
      ),
    )

    expect(words.figure).toBe('41 of 40')
    expect(words.line).toBe('Goal passed · 4 days left')
  })

  it('the last day says so in the line', () => {
    const words = figureOf(
      runningWords(month({ elapsedDays: 30, daysAfterToday: 0, belowPace: true })),
    )

    expect(words.line).toBe('17 to go · last day')
  })

  it('the first quiet days keep the same words', () => {
    // Nov 2: the first days are never judged, and the ruler has no steady stop yet.
    const words = figureOf(
      runningWords(
        month({
          value: 1,
          elapsedDays: 2,
          daysAfterToday: 28,
          belowPace: null,
          quietDays: true,
        }),
      ),
    )

    expect(words.line).toBe('39 to go · 29 days left')
    expect(words.headline).toMatchObject({ count: '39' })
  })

  it('unreadable shows no figure and no zero', () => {
    const words = runningWords(month({ value: null, target: 45, belowPace: null }))

    expect(words).toEqual({
      kind: 'unreadable',
      heading: 'November · 45 private ratings',
      line: 'This month’s figure can’t be read right now.',
    })
  })

  it('never says the pace in a word: the pill says it (Q-5)', () => {
    // Behind, on the way, not judged and in the quiet days read the same.
    const spoken = (patch: Partial<PortalGoalRunningMonth>) => runningWords(month(patch))

    const behind = spoken({ belowPace: true })
    expect(spoken({ belowPace: false })).toEqual(behind)
    expect(spoken({ belowPace: null })).toEqual(behind)
    expect(JSON.stringify(behind)).not.toMatch(/pace/iu)
  })
})

describe('the days left in the month, and what a day gets you there', () => {
  const line = (patch: Partial<PortalGoalRunningMonth>) =>
    figureOf(runningWords(month(patch))).daysLine

  it('names the days left in the month and what a day takes: 9 days left in November. About 2 a day gets you there.', () => {
    expect(line({})).toBe('9 days left in November. About 2 a day gets you there.')
    expect(line({ key: '2026-12', daysAfterToday: 9 })).toBe(
      '10 days left in December. About 2 a day gets you there.',
    )
  })

  it('counts today as a day left: 17 over 2 days is about 9 a day', () => {
    expect(line({ daysAfterToday: 1 })).toBe(
      '2 days left in November. About 9 a day gets you there.',
    )
  })

  it('rounds the day’s share up: fewer a day would not get you there', () => {
    // 10 left over 4 days is 2.5.
    expect(line({ value: 30, daysAfterToday: 3 })).toBe(
      '4 days left in November. About 3 a day gets you there.',
    )
    // 10 left over 7 days is 1.43.
    expect(line({ value: 30, daysAfterToday: 6 })).toBe(
      '7 days left in November. About 2 a day gets you there.',
    )
  })

  it('says under 1 a day when there is less than a rating to get each day', () => {
    // 8 left over 9 days is 0.89.
    expect(line({ value: 32 })).toBe(
      '9 days left in November. Under 1 a day gets you there.',
    )
    // 9 left over 9 days is exactly 1.
    expect(line({ value: 31 })).toBe(
      '9 days left in November. About 1 a day gets you there.',
    )
  })

  it('groups a large share', () => {
    expect(line({ target: 12_000, value: 0, daysAfterToday: 9 })).toBe(
      '10 days left in November. About 1,200 a day gets you there.',
    )
  })

  it('names the last day by its name, with no pace to keep up', () => {
    expect(line({ daysAfterToday: 0 })).toBe('Last day of November')
    expect(line({ key: '2026-12', daysAfterToday: 0, value: 39 })).toBe(
      'Last day of December',
    )
  })

  it('says only the days once the number is passed, or met to the number', () => {
    expect(line({ value: 41, daysAfterToday: 3 })).toBe('4 days left in November')
    expect(line({ value: 40, daysAfterToday: 3 })).toBe('4 days left in November')
    expect(line({ value: 43, daysAfterToday: 0 })).toBe('Last day of November')
  })

  it('agrees with "17 to go · last day" on which day is the last, for every day of a month', () => {
    for (let after = 0; after < 31; after += 1) {
      const words = figureOf(runningWords(month({ daysAfterToday: after })))

      expect(words.daysLine.startsWith('Last day')).toBe(words.line.endsWith('last day'))
    }
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
    measure: 'portal_rating_count',
    value: 36,
    target: 40,
    outcome: 'updating',
    finalOn: '2026-12-02',
    ...patch,
  })

  it('the month before is counting its last readings until its final figure', () => {
    expect(lastMonthWords(last({}))).toEqual({
      text: 'November: counting the last ratings. Final figure on Dec 2.',
      met: false,
    })
    expect(lastMonthWords(last({ measure: 'qualified_scans' }))?.text).toBe(
      'November: counting the last scans. Final figure on Dec 2.',
    )
  })

  it('names no day once the day its final figure was due has gone', () => {
    expect(lastMonthWords(last({ finalOn: null }))).toEqual({
      text: 'November: counting the last ratings.',
      met: false,
    })
  })

  it('then met, or not met in neutral words', () => {
    expect(lastMonthWords(last({ value: 41, outcome: 'met' }))).toEqual({
      text: 'November met: 41 of 40',
      met: true,
    })
    expect(lastMonthWords(last({ outcome: 'not_met' }))).toEqual({
      text: 'November: 36 of 40 · not met',
      met: false,
    })
  })

  it('says nothing of a month with no usable result', () => {
    expect(lastMonthWords(last({ value: null, outcome: 'unavailable' }))).toBeNull()
  })
})
