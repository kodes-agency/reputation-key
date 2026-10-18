import { describe, expect, it } from 'vitest'
import type { PortalGoalLastMonth } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import {
  CHECK_IN_NOTHING,
  CHECK_IN_OFFER,
  CHECK_IN_SAME,
  CHECK_IN_SCANS,
} from './portal-goal-check-in.stories.fixtures'
import {
  checkInLastMonthWords,
  checkInWords,
  sameNumberWords,
} from './portal-goal-check-in-view'

/** November while it is read on Dec 1: 36 of 40 so far, final on Dec 2. */
const NOVEMBER_UPDATING: PortalGoalLastMonth = {
  key: '2026-11',
  measure: 'portal_rating_count',
  value: 36,
  target: 40,
  outcome: 'updating',
  finalOn: '2026-12-02',
}

describe('the month-start check-in, worded', () => {
  it('last month so far, then met with a check, or not met neutral', () => {
    // K-1 while November is read.
    expect(checkInLastMonthWords(NOVEMBER_UPDATING)).toEqual({
      text: 'November: 36 of 40 so far. Final figure on Dec 2.',
      met: false,
    })
    // Its final figure late: no day already gone is promised.
    expect(checkInLastMonthWords({ ...NOVEMBER_UPDATING, finalOn: null })).toEqual({
      text: 'November: 36 of 40 so far.',
      met: false,
    })
    // No figure to say yet: the card's own updating line (G-30).
    expect(checkInLastMonthWords({ ...NOVEMBER_UPDATING, value: null })).toEqual({
      text: 'November: counting the last ratings. Final figure on Dec 2.',
      met: false,
    })
    // K-6: once it has closed, G-31.
    expect(
      checkInLastMonthWords({ ...NOVEMBER_UPDATING, value: 41, outcome: 'met' }),
    ).toEqual({ text: 'November met: 41 of 40', met: true })
    expect(
      checkInLastMonthWords({ ...NOVEMBER_UPDATING, value: 36, outcome: 'not_met' }),
    ).toEqual({ text: 'November: 36 of 40 · not met', met: false })
    expect(
      checkInLastMonthWords({
        ...NOVEMBER_UPDATING,
        value: null,
        outcome: 'unavailable',
      }),
    ).toBeNull()
    expect(checkInLastMonthWords(null)).toBeNull()
  })

  it('Use 45 only when it differs from 40', () => {
    expect(checkInWords(CHECK_IN_OFFER)).toEqual({
      heading: 'For December',
      use: {
        label: 'Use 45',
        caption: 'Recommended · a bit above your usual of about 38',
        targetValue: 45,
        toast: 'December goal: 45 private ratings',
      },
      lead: null,
      keep: { label: 'Keep 40', toast: 'December stays at 40' },
      other: 'Other number',
      foot: 'Nothing changes unless you choose. December counts against 40 until then.',
    })
    // The same number is no choice: one line under the card, and Change (K-7).
    expect(sameNumberWords(CHECK_IN_SAME)).toEqual({
      text: 'December stays at 45. It is still the recommended number.',
      change: 'Change',
    })
  })

  it('nothing counted keeps Keep and Other number', () => {
    expect(checkInWords(CHECK_IN_NOTHING)).toEqual({
      heading: 'For December',
      use: null,
      lead: 'No recommendation this month: no private ratings in the last 4 weeks.',
      keep: { label: 'Keep 40', toast: 'December stays at 40' },
      other: 'Other number',
      foot: 'Nothing changes unless you choose. December counts against 40 until then.',
    })
  })

  it('a goal that counts scans says scans', () => {
    expect(checkInWords(CHECK_IN_SCANS)).toMatchObject({
      use: {
        label: 'Use 55 scans',
        targetValue: 55,
        toast: 'December goal: 55 scans',
      },
      keep: { label: 'Keep 50 scans', toast: 'December stays at 50' },
    })
    expect(
      checkInWords({ ...CHECK_IN_NOTHING, measure: 'qualified_scans', weeks: 3 }),
    ).toMatchObject({
      lead: 'No recommendation this month: no scans in the last 3 weeks.',
    })
  })
})
