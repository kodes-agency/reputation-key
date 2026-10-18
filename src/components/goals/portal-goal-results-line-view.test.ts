import { describe, expect, it } from 'vitest'
import type { PortalGoalLineView } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { resultsLineWords } from './portal-goal-results-line-view'

/** Nov 22 at Seaview: Reception's 13 of the month's 23 private ratings. */
const COUNTS_TOWARD: PortalGoalLineView = {
  month: '2026-11',
  monthlyGoal: { measure: 'portal_rating_count', count: 13 },
  ownGoal: null,
}

/** Reception's own goal of 20, 14 in so far. */
const RECEPTION_GOAL = {
  programId: 'program-reception',
  measure: 'portal_rating_count',
  value: 14,
  target: 20,
} as const
const OWN_GOAL: PortalGoalLineView = { ...COUNTS_TOWARD, ownGoal: RECEPTION_GOAL }

describe('resultsLineWords', () => {
  it('counts toward the monthly goal', () => {
    expect(resultsLineWords(COUNTS_TOWARD, 'Reception')).toEqual({
      text: 'November · Reception’s 13 private ratings count toward the monthly portal goal.',
      goal: { kind: 'monthly' },
      open: 'Open goal',
    })
    // One is singular; scans say scans.
    expect(
      resultsLineWords(
        { ...COUNTS_TOWARD, monthlyGoal: { measure: 'qualified_scans', count: 1 } },
        'Spa',
      )?.text,
    ).toBe('November · Spa’s 1 scan counts toward the monthly portal goal.')
  })

  it('own goal says 14 of 20 · 6 to go', () => {
    expect(resultsLineWords(OWN_GOAL, 'Reception')).toEqual({
      text: 'November goal: 14 of 20 private ratings · 6 to go',
      goal: { kind: 'own', programId: 'program-reception' },
      open: 'Open goal',
    })
    // Passed: no "to go" below zero.
    expect(
      resultsLineWords(
        {
          ...OWN_GOAL,
          ownGoal: { ...RECEPTION_GOAL, value: 22 },
          monthlyGoal: null,
        },
        'Reception',
      )?.text,
    ).toBe('November goal: 22 of 20 private ratings · Goal passed')
  })

  it('a draft gets no line', () => {
    // The read answers no line for a draft Portal, or with no goal counting.
    expect(resultsLineWords(null, 'Bar')).toBeNull()
  })
})
