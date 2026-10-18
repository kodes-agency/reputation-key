import { describe, expect, it } from 'vitest'
import {
  checkInMonthAt,
  monthlyCheckIn,
  type MonthlyCheckInInput,
} from './portal-goal-check-in'

const SOFIA = 'Europe/Sofia'

/**
 * Seaview's goal on Dec 1 (G4): it has run since November at 40, and the
 * recommended number for a 31-day December is 45.
 */
const DEC_1: MonthlyCheckInInput = {
  // 00:30 on Dec 1 in Sofia (UTC+2 since Oct 25).
  now: new Date('2026-11-30T22:30:00.000Z'),
  timezone: SOFIA,
  goal: { status: 'active', firstMonthKey: '2026-11', currentTarget: 40 },
  answeredMonth: null,
  changedThisMonth: false,
  recommendation: { aBitMore: 45 },
}

/** The check-in at a Sofia wall-clock time, its offset given (+02:00 or +03:00). */
const at = (local: string, offset: '+02:00' | '+03:00'): MonthlyCheckInInput => ({
  ...DEC_1,
  now: new Date(`${local}${offset}`),
  goal: { ...DEC_1.goal, firstMonthKey: '2026-01' },
})

const shown = (input: MonthlyCheckInInput) => monthlyCheckIn(input) !== null

describe('the month-start check-in', () => {
  it('Dec 1: Use 45 for a goal of 40', () => {
    expect(monthlyCheckIn(DEC_1)).toEqual({ kind: 'offer', month: '2026-12', number: 45 })
  })

  // Each month at its first minute and its last of days 1 to 8: 28 and 29 days
  // in February, 30 and 31 days, and the months either side of Sofia's clock
  // changes (back on Oct 25, 2026; forward on Mar 28, 2027).
  const MONTHS: ReadonlyArray<
    readonly [label: string, month: string, offset: '+02:00' | '+03:00']
  > = [
    ['November, after the clocks went back', '2026-11', '+02:00'],
    ['December, 31 days', '2026-12', '+02:00'],
    ['February, 28 days', '2027-02', '+02:00'],
    ['March, before the clocks go forward', '2027-03', '+02:00'],
    ['April, 30 days, after the clocks went forward', '2027-04', '+03:00'],
    ['February, 29 days', '2028-02', '+02:00'],
  ]
  const DAYS = [1, 2, 3, 4, 5, 6, 7, 8] as const

  describe.each(MONTHS)('%s', (_label, month, offset) => {
    it.each(DAYS)('day %i: on days 1 to 7 only', (day) => {
      const date = `${month}-${String(day).padStart(2, '0')}`
      const first = at(`${date}T00:00:00`, offset)
      const last = at(`${date}T23:59:00`, offset)

      expect([shown(first), shown(last)]).toEqual(
        day <= 7 ? [true, true] : [false, false],
      )
      expect(monthlyCheckIn(first)).toEqual(
        day <= 7 ? { kind: 'offer', month, number: 45 } : null,
      )
    })

    it.each(DAYS.filter((day) => day <= 7))(
      'day %i: never once answered, or once stopped',
      (day) => {
        const open = at(`${month}-0${day}T12:00:00`, offset)

        expect(monthlyCheckIn({ ...open, answeredMonth: month })).toBeNull()
        expect(
          monthlyCheckIn({ ...open, goal: { ...open.goal, status: 'ended' } }),
        ).toBeNull()
        // Last month's answer is not this month's.
        expect(shown({ ...open, answeredMonth: '2026-10' })).toBe(true)
      },
    )
  })

  it.each([
    ['the last day of a 28-day February', '2027-02-28T23:59:00+02:00', null],
    ['the first minute of March', '2027-03-01T00:00:00+02:00', '2027-03'],
    ['the last day of a 29-day February', '2028-02-29T12:00:00+02:00', null],
    ['the last day of a 30-day month', '2027-04-30T23:59:00+03:00', null],
    ['the first minute of May', '2027-05-01T00:00:00+03:00', '2027-05'],
    ['the last day of a 31-day month', '2026-12-31T23:59:00+02:00', null],
    ['the first minute of January', '2027-01-01T00:00:00+02:00', '2027-01'],
    ['Oct 25, when the clocks go back', '2026-10-25T03:30:00+02:00', null],
    ['the last minute of October, on winter time', '2026-10-31T23:59:00+02:00', null],
    ['the first minute of November', '2026-11-01T00:00:00+02:00', '2026-11'],
    ['Mar 28, when the clocks go forward', '2027-03-28T04:30:00+03:00', null],
    ['the last minute of March, on summer time', '2027-03-31T23:59:00+03:00', null],
    ['the first minute of April', '2027-04-01T00:00:00+03:00', '2027-04'],
    ['the last minute of Apr 7', '2027-04-07T23:59:00+03:00', '2027-04'],
    ['the first minute of Apr 8', '2027-04-08T00:00:00+03:00', null],
  ])('%s: the check-in month is %s', (_label, instant, month) => {
    expect(checkInMonthAt(new Date(instant), SOFIA)).toBe(month)
  })

  it("not in the goal's first month", () => {
    // Set for December on Nov 25: December is its first month, nothing to check.
    expect(
      monthlyCheckIn({ ...DEC_1, goal: { ...DEC_1.goal, firstMonthKey: '2026-12' } }),
    ).toBeNull()
  })

  it('only while the goal runs', () => {
    for (const status of ['scheduled', 'paused', 'ended'] as const) {
      expect(monthlyCheckIn({ ...DEC_1, goal: { ...DEC_1.goal, status } })).toBeNull()
    }
  })

  it('a target change this month answers it', () => {
    // "Use 45", or another number through the sheet, changed December already.
    expect(monthlyCheckIn({ ...DEC_1, changedThisMonth: true })).toBeNull()
  })

  it('Keep answers it for the month it was kept', () => {
    expect(monthlyCheckIn({ ...DEC_1, answeredMonth: '2026-12' })).toBeNull()
  })

  it('same number is a line, not a choice', () => {
    expect(
      monthlyCheckIn({ ...DEC_1, goal: { ...DEC_1.goal, currentTarget: 45 } }),
    ).toEqual({ kind: 'same', month: '2026-12' })
  })

  it('nothing counted over the basis offers no number, and still asks', () => {
    expect(monthlyCheckIn({ ...DEC_1, recommendation: 'nothing' })).toEqual({
      kind: 'nothing',
      month: '2026-12',
    })
  })

  it('a recommendation that cannot be read asks nothing', () => {
    expect(monthlyCheckIn({ ...DEC_1, recommendation: null })).toBeNull()
  })
})
