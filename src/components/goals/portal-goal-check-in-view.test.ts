import { describe, expect, it } from 'vitest'
import type { PortalGoalLastMonth } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import {
  CHECK_IN_NOTHING,
  CHECK_IN_OFFER,
  CHECK_IN_SAME,
  CHECK_IN_SCANS,
} from './portal-goal-check-in.stories.fixtures'
import { checkInWords, sameNumberWords } from './portal-goal-check-in-view'

/** November while it is read on Dec 1: 36 of 40 so far, final on Dec 2. */
const NOVEMBER_UPDATING: PortalGoalLastMonth = {
  key: '2026-11',
  measure: 'portal_rating_count',
  value: 36,
  target: 40,
  outcome: 'updating',
  finalOn: '2026-12-02',
}

/** The strip's headline for the month before, with an offer asking (any asking check-in says it the same). */
const headlineOf = (lastMonth: PortalGoalLastMonth | null) =>
  checkInWords(CHECK_IN_OFFER, lastMonth).headline

describe('the month-start check-in, worded', () => {
  it('the headline: last month so far, then met, or not met neutral, without a check', () => {
    // K-1 while November is read.
    expect(headlineOf(NOVEMBER_UPDATING)).toBe(
      'November: 36 of 40 so far. Final figure on Dec 2.',
    )
    // Its final figure late: no day already gone is promised.
    expect(headlineOf({ ...NOVEMBER_UPDATING, finalOn: null })).toBe(
      'November: 36 of 40 so far.',
    )
    // No figure to say yet: the card's own updating line (G-30).
    expect(headlineOf({ ...NOVEMBER_UPDATING, value: null })).toBe(
      'November: counting the last ratings. Final figure on Dec 2.',
    )
    // K-6: once it has closed, G-31.
    expect(headlineOf({ ...NOVEMBER_UPDATING, value: 41, outcome: 'met' })).toBe(
      'November met: 41 of 40',
    )
    expect(headlineOf({ ...NOVEMBER_UPDATING, value: 36, outcome: 'not_met' })).toBe(
      'November: 36 of 40 · not met',
    )
    // Nothing to say of the month before: no headline at all.
    expect(
      headlineOf({ ...NOVEMBER_UPDATING, value: null, outcome: 'unavailable' }),
    ).toBeNull()
    expect(headlineOf(null)).toBeNull()
  })

  it('Use 45 only when it differs from 40, recommended first', () => {
    expect(checkInWords(CHECK_IN_OFFER, NOVEMBER_UPDATING)).toEqual({
      label: 'For December',
      headline: 'November: 36 of 40 so far. Final figure on Dec 2.',
      sub: 'Your goal is 40 a month. 45 is recommended for December, a bit above your usual of about 38.',
      use: {
        label: 'Use 45',
        targetValue: 45,
        toast: 'December goal: 45 private ratings',
      },
      keep: { label: 'Keep 40', toast: 'December stays at 40' },
      other: 'Other number',
      note: 'Nothing changes unless you choose. December counts against 40 until then.',
    })
    // The same number is no choice: one line under the card, and Change (K-7).
    expect(sameNumberWords(CHECK_IN_SAME)).toEqual({
      text: 'December stays at 45. It is still the recommended number.',
      change: 'Change',
    })
  })

  it('nothing counted keeps Keep and Other number, and says why there is no number', () => {
    expect(checkInWords(CHECK_IN_NOTHING, NOVEMBER_UPDATING)).toEqual({
      label: 'For December',
      headline: 'November: 36 of 40 so far. Final figure on Dec 2.',
      sub: 'No recommendation this month: no private ratings in the last 4 weeks.',
      use: null,
      keep: { label: 'Keep 40', toast: 'December stays at 40' },
      other: 'Other number',
      note: 'Nothing changes unless you choose. December counts against 40 until then.',
    })
  })

  it('a goal that counts scans says scans', () => {
    expect(checkInWords(CHECK_IN_SCANS, null)).toMatchObject({
      headline: null,
      sub: 'Your goal is 50 scans a month. 55 scans is recommended for December, a bit above your usual of about 49.',
      use: {
        label: 'Use 55 scans',
        targetValue: 55,
        toast: 'December goal: 55 scans',
      },
      keep: { label: 'Keep 50 scans', toast: 'December stays at 50' },
    })
    expect(
      checkInWords({ ...CHECK_IN_NOTHING, measure: 'qualified_scans', weeks: 3 }, null),
    ).toMatchObject({
      sub: 'No recommendation this month: no scans in the last 3 weeks.',
    })
  })
})
