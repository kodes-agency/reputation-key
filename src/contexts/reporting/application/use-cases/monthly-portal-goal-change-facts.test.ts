// What the card read says a change to the Monthly portal goal is made against
// (PLAN PG-14): the running month while its number can still change, the month
// a change from a coming month starts with, and the month the sheet opens on;
// and, once the goal was stopped, the month a new goal can start in.
import { describe, expect, it } from 'vitest'
import { isPropertyCountGoal } from '../monthly-portal-goal-identity'
import {
  readMonthlyPortalGoalCard,
  type MonthlyPortalGoalCardDeps,
} from './monthly-portal-goal-card'
import { changeFactsOf, newGoalFromOf } from './monthly-portal-goal-change-facts'
import {
  DEC_1,
  NOV_1,
  NOV_22,
  OCT_23,
  PROPERTY_ID,
  actor,
  fakeWorld,
  goalOf,
  governed,
  propertyGoal,
  runningGoal,
  withNextVersion,
} from './monthly-portal-goal-test-fixtures'

const read = (deps: MonthlyPortalGoalCardDeps) =>
  readMonthlyPortalGoalCard(deps, { propertyId: PROPERTY_ID }, actor)

const NOVEMBER_PERIOD = { start: NOV_1.toISOString(), end: DEC_1.toISOString() }

/** The card's goal on a day, with the Programs given. */
async function goalOn(now: Date, programs = [runningGoal()]) {
  const { deps } = fakeWorld({ now, programs, figure: governed(23) })
  return goalOf(await read(deps))
}

describe('what a change to the Monthly portal goal is made against', () => {
  it('a running goal on Nov 22 changes November now, or from December', async () => {
    const { deps } = fakeWorld({
      now: NOV_22,
      programs: [runningGoal()],
      figure: governed(23),
    })

    const card = await read(deps)

    expect(goalOf(card).change).toEqual({
      now: {
        monthKey: '2026-11',
        expectedTarget: 40,
        expectedVersion: 1,
        expectedFollowingMonth: '2026-12',
        appliesToFollowing: true,
        period: NOVEMBER_PERIOD,
        timezone: 'Europe/Sofia',
      },
      nextMonthKey: '2026-12',
      // After the 20th a change opens on the next month.
      opensOn: 'next',
    })
    expect(goalOf(card).newGoalFrom).toBeNull()
    // The sheet works from the same read as before a goal: both months, both measures.
    expect(card.state === 'goal' ? card.sheet.ownNumber : null).toEqual({
      current: { key: '2026-11', soFar: { ratings: 0, scans: 0 } },
      next: { key: '2026-12' },
    })
  })

  it('opens on now through the 20th, on next after it, and the last day still changes now', async () => {
    const nov20 = await goalOn(new Date('2026-11-20T20:00:00.000Z'))
    const nov21 = await goalOn(new Date('2026-11-20T23:00:00.000Z'))
    // 23:30 on Nov 30 in Sofia: the month's last half hour.
    const lastDay = await goalOn(new Date('2026-11-30T21:30:00.000Z'))

    expect(nov20.change).toMatchObject({ opensOn: 'now', now: { monthKey: '2026-11' } })
    expect(nov21.change).toMatchObject({ opensOn: 'next', now: { monthKey: '2026-11' } })
    expect(lastDay.change).toMatchObject({
      opensOn: 'next',
      now: { monthKey: '2026-11', expectedFollowingMonth: '2026-12' },
      nextMonthKey: '2026-12',
    })
  })

  it("expects the month's own number, and the version of a change already waiting", async () => {
    const own = await goalOn(NOV_22, [runningGoal({ target: 45 })])
    const waiting = await goalOn(NOV_22, [
      withNextVersion(runningGoal(), { targetValue: 45, from: DEC_1 }),
    ])

    expect(own.change?.now).toMatchObject({ expectedTarget: 45, expectedVersion: 1 })
    expect(waiting.change).toMatchObject({
      now: { expectedTarget: 40, expectedVersion: 2, expectedFollowingMonth: '2026-12' },
      nextMonthKey: '2026-12',
    })
  })

  it("after Count scans instead, a change now is the month's alone: December keeps scans", async () => {
    const switched = await goalOn(NOV_22, [
      withNextVersion(runningGoal(), {
        metric: 'qualified_scans',
        targetValue: 55,
        from: DEC_1,
      }),
    ])
    const sameMeasure = await goalOn(NOV_22, [
      withNextVersion(runningGoal(), { targetValue: 45, from: DEC_1 }),
    ])

    expect(switched.change?.now).toMatchObject({
      monthKey: '2026-11',
      expectedVersion: 2,
      appliesToFollowing: false,
    })
    expect(sameMeasure.change?.now).toMatchObject({ appliesToFollowing: true })
  })

  it('a scheduled goal changes from its first month, with no month to change now', async () => {
    const scheduled = await goalOn(OCT_23, [
      propertyGoal('monthly', 'portal_rating_count'),
    ])

    expect(scheduled.change).toEqual({
      now: null,
      nextMonthKey: '2026-11',
      opensOn: 'next',
    })
  })

  it('a stopped goal takes no change; a new goal can start the month after it', async () => {
    const stopped = (months: Parameters<typeof propertyGoal>[2]) =>
      propertyGoal('monthly', 'portal_rating_count', {
        status: 'ended',
        until: DEC_1,
        endedAt: new Date('2026-11-12T08:00:00.000Z'),
        ...months,
      })

    const nov22 = await goalOn(NOV_22, [stopped({ open: { start: NOV_1, end: DEC_1 } })])
    // On Dec 1 November is still read, and December is this month.
    const dec1 = await goalOn(new Date('2026-12-01T10:00:00.000Z'), [
      stopped({ months: [{ start: NOV_1, end: DEC_1, status: 'reconciling' }] }),
    ])

    expect(nov22).toMatchObject({ change: null, newGoalFrom: '2026-12' })
    expect(dec1).toMatchObject({ change: null, newGoalFrom: '2026-12' })
  })

  it('stopped before December was opened, the goal holds Dec 1 to the stop: the next goal is from January', async () => {
    // Stopped at 00:05 on Dec 1 in Sofia: its window ends there, so a goal
    // from Dec 1 would meet it; January is the first month it leaves whole.
    const stoppedEarly = propertyGoal('monthly', 'portal_rating_count', {
      status: 'ended',
      until: new Date('2026-11-30T22:05:00.000Z'),
      endedAt: new Date('2026-11-30T22:05:00.000Z'),
      months: [{ start: NOV_1, end: DEC_1, status: 'reconciling' }],
    })

    const dec1 = await goalOn(new Date('2026-12-01T10:00:00.000Z'), [stoppedEarly])

    expect(dec1).toMatchObject({ change: null, newGoalFrom: '2027-01' })
  })
})

describe('changeFactsOf and newGoalFromOf', () => {
  const months = {
    current: { key: '2026-11', days: 30, daysLeftWithToday: 9 },
    next: { key: '2026-12', days: 31 },
  } as const

  it('an ended goal takes no change', () => {
    const ended = propertyGoal('monthly', 'portal_rating_count', {
      status: 'ended',
      until: DEC_1,
      open: { start: NOV_1, end: DEC_1 },
    })

    if (!isPropertyCountGoal(ended)) throw new Error('expected a Property count goal')
    expect(changeFactsOf(ended, NOV_22, 'Europe/Sofia')).toBeNull()
  })

  it('only a stopped goal has a way to the next, and only to a month the sheet offers', () => {
    const goal = (shape: Parameters<typeof propertyGoal>[2]) => {
      const bundle = propertyGoal('monthly', 'portal_rating_count', shape)
      if (!isPropertyCountGoal(bundle)) throw new Error('expected a Property count goal')
      return bundle
    }
    const stoppedUntil = (until: Date) =>
      goal({ status: 'ended', until, open: { start: NOV_1, end: DEC_1 } })

    expect(
      newGoalFromOf(
        goal({ status: 'active', open: { start: NOV_1, end: DEC_1 } }),
        'Europe/Sofia',
        months,
      ),
    ).toBeNull()
    expect(newGoalFromOf(stoppedUntil(DEC_1), 'Europe/Sofia', months)).toBe('2026-12')
    // Its windows held all of December: January is no month this sheet can set.
    expect(
      newGoalFromOf(
        stoppedUntil(new Date('2026-12-31T22:00:00.000Z')),
        'Europe/Sofia',
        months,
      ),
    ).toBeNull()
  })
})
