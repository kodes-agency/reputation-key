import { describe, expect, it } from 'vitest'
import type { GoalResultsMatrix } from '#/contexts/reporting/application/public-api'
import { resultGoals } from './portal-goal-results-list-view'
import {
  ALL_EVIDENCE_STATES,
  CHANGED_IN_JULY,
  CORRECTED_MONTH,
  FOUR_MONTHS,
  LIST_NOW,
  SET_IN_AN_EARLIER_YEAR,
  listPersonName,
  monthOf,
  provenanceOf,
  resultRow,
} from './portal-goal-results-list.stories.fixtures'
import {
  RESULTS_NOW,
  SEAVIEW_GOALS,
  personName,
  resultsOf,
} from './portal-goal-results.stories.fixtures'

// What is behind a row of the results list (when its figure was final, who set the
// number, a change, a correction) and the bars of a goal's months. The goals and the
// words of each month are `portal-goal-results-list-view.test.ts`.
const goalsOf = (matrix: GoalResultsMatrix) =>
  resultGoals(matrix, { now: LIST_NOW, personName: listPersonName })

describe('resultGoals: behind the row', () => {
  const detailsOf = (matrix: GoalResultsMatrix, index = 0) =>
    goalsOf(matrix)[index]?.measures[0]?.rows[0]?.details

  it('says the day the figure was counted through, and the number with the day it was set', () => {
    expect(detailsOf(ALL_EVIDENCE_STATES)).toEqual([
      'Counted through Jul 31, 2026.',
      'The number was 100, set on Jun 18.',
    ])
  })

  it('leaves out the day counted through while there is none', () => {
    // The Lobby's count could not be read.
    expect(detailsOf(ALL_EVIDENCE_STATES, 3)).toEqual([
      'The number was 100, set on Jun 18.',
    ])
  })

  it('says an average’s number in tenths', () => {
    expect(detailsOf(ALL_EVIDENCE_STATES, 2)).toContain(
      'The number was 4.5, set on Jun 18.',
    )
  })

  it('prints the year of a number set in an earlier year', () => {
    expect(detailsOf(SET_IN_AN_EARLIER_YEAR)).toContain(
      'The number was 100, set on Dec 18, 2025.',
    )
  })

  it('names who changed the month’s number, when, how often and what it started at', () => {
    expect(detailsOf(CHANGED_IN_JULY)).toContain(
      'Changed by Marco Rossi on Jul 20 (2 changes), started at 150',
    )
    // The Portal’s month nobody changed has no such line.
    expect(detailsOf(CHANGED_IN_JULY, 1)?.some((line) => /^Changed/u.test(line))).toBe(
      false,
    )
  })

  it('says a change without a name where the directory cannot give one', () => {
    const [goal] = resultGoals(CHANGED_IN_JULY, { now: LIST_NOW, personName: () => null })

    expect(goal?.measures[0]?.rows[0]?.details).toContain(
      'Changed on Jul 20 (2 changes), started at 150',
    )
  })

  it('says when the month was corrected, last', () => {
    const details = detailsOf(CORRECTED_MONTH)

    expect(details?.at(-1)).toBe('Corrected on Aug 3.')
    expect(details).toHaveLength(3)
  })
})

describe('resultGoals: the bars', () => {
  const barsOf = (matrix: GoalResultsMatrix) => goalsOf(matrix)[0]?.bars ?? null

  it('has none for a goal with a single month: one bar compares nothing', () => {
    expect(goalsOf(ALL_EVIDENCE_STATES).map(({ bars }) => bars)).toEqual(
      Array.from({ length: 5 }, () => null),
    )
  })

  it('draws a goal’s months oldest first, each against its own number', () => {
    expect(barsOf(FOUR_MONTHS)).toEqual({
      caption: 'Scans each month. The short line is that month’s number.',
      columns: [
        {
          key: 'scans-2026-05',
          label: 'May',
          value: 80,
          figure: '80',
          tone: 'since',
          mark: 100,
          met: false,
          line: 'May 2026: 80 of 100. Missed by 20.',
        },
        {
          key: 'scans-2026-06',
          label: 'Jun',
          value: 120,
          figure: '120',
          tone: 'since',
          mark: 100,
          met: true,
          line: 'June 2026: 120 of 100. Met.',
        },
        {
          key: 'scans-2026-07',
          label: 'Jul',
          value: 90,
          figure: '90',
          tone: 'since',
          mark: 100,
          met: false,
          line: 'July 2026: 90 of 100. Missed by 10.',
        },
        {
          key: 'scans-2026-08',
          label: 'Aug',
          value: 7,
          figure: '7',
          tone: 'open',
          mark: 100,
          met: false,
          line: 'August 2026: 7 of 100. The final figure is on its way.',
        },
      ],
    })
  })

  it('draws the bars of what the goal counts now, and no bar for a month with no figure', () => {
    const [goal] = resultGoals(resultsOf(SEAVIEW_GOALS).matrix, {
      now: RESULTS_NOW,
      personName,
    })

    // December has no figure yet and the two scans months were an earlier block.
    expect(goal?.bars?.caption).toBe(
      'Private ratings each month. The short line is that month’s number.',
    )
    expect(goal?.bars?.columns.map(({ label, value }) => [label, value])).toEqual([
      ['Oct', 41],
      ['Nov', 36],
    ])
  })

  it('has none for an average, which a bar would not compare', () => {
    const average = (yearMonth: string) =>
      monthOf(yearMonth, [
        resultRow(`average-${yearMonth}`, {
          metric: 'portal_rating_average',
          evidence: { kind: 'average', value: 4.6, sampleCount: 31, minimumSample: 10 },
          targetProvenance: provenanceOf('Spa average', 4.5),
        }),
      ])

    expect(barsOf({ months: [average('2026-07'), average('2026-06')] })).toBeNull()
  })

  it('draws 12 months at most, the latest', () => {
    // 14 months of a UTC property, newest first: Dec 2026 back to Nov 2025.
    const months = Array.from({ length: 14 }, (_, index) => {
      const start = new Date(Date.UTC(2026, 11 - index, 1))
      const end = new Date(Date.UTC(2026, 12 - index, 1))
      const rows = [resultRow(`utc-${index}`, { dataThrough: end })]
      return { periodStart: start, periodEnd: end, propertyTimezone: 'UTC', rows }
    })
    const columns = barsOf({ months })?.columns ?? []

    expect(columns.map(({ label }) => label)).toEqual([
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ])
    expect(columns.at(0)?.line).toMatch(/^January 2026: /u)
  })
})
