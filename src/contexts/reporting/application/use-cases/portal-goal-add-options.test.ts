import { describe, expect, it } from 'vitest'
import type { RecommendationGroupDayCount } from '../../domain/goal-recommendation-types'
import {
  actor,
  days,
  fakeWorld,
  NOV_22,
  portal,
  propertyGoal,
  PROPERTY_ID,
  readings,
} from './monthly-portal-goal-test-fixtures'
import { readPortalGoalAddOptions } from './portal-goal-add-options'

// Nov 18, midday in Sofia: November is the month offered (through the 20th).
const NOV_18 = new Date('2026-11-18T10:00:00.000Z')

const read = (world: Parameters<typeof fakeWorld>[0]) => {
  const { deps, calls } = fakeWorld(world)
  return {
    calls,
    deps,
    options: readPortalGoalAddOptions(deps, { propertyId: PROPERTY_ID }, actor),
  }
}

/** A goal for one Portal, from November, 22 a month. */
function portalGoal(id: string, portalId: string) {
  const goal = propertyGoal(id, 'portal_rating_count', { status: 'active' })
  return {
    ...goal,
    program: { ...goal.program, name: 'Reception · Private ratings' },
    assignments: goal.assignments.map((assignment) => ({
      ...assignment,
      subject: { kind: 'portal' as const, portalId },
    })),
  }
}

const groupDays = (
  groupId: string,
  localDays: readonly string[],
  count = 1,
): RecommendationGroupDayCount[] =>
  localDays.map((localDay) => ({
    groupId,
    measure: 'portal_rating_count',
    localDay,
    count,
  }))

describe('what Add a portal goal offers', () => {
  it("a portal's own usual gives 20 · 22 · 24", async () => {
    // Nov 22: December is offered. Reception has 9 private ratings in its 14
    // live days (Nov 8 to 21); Restaurant 20 in 28.
    const { options } = read({
      now: NOV_22,
      portals: [portal('Reception', '2026-11-08'), portal('Restaurant', '2026-10-01')],
      counts: {
        days: [
          ...readings('portal-reception', 'portal_rating_count', days('2026-11-08', 9)),
          ...readings('portal-restaurant', 'portal_rating_count', days('2026-10-25', 20)),
        ],
      },
    })

    const { month, current, measure, onePortal, eachPortal } = await options

    expect({ month, current, measure }).toEqual({
      month: '2026-12',
      current: false,
      measure: 'portal_rating_count',
    })
    expect(onePortal.map(({ name, choices }) => [name, choices])).toEqual([
      ['Reception', { usual: 20, aBitMore: 22, stretch: 24 }],
      ['Restaurant', expect.objectContaining({ usual: 23 })],
    ])
    expect(eachPortal[0]).toMatchObject({ ticked: true, number: 22 })
  })

  it('a Portal that moved groups on the 10th counts in its old group until the 10th and its new group after', async () => {
    // Spa moved from Rooms to Wellness on Nov 10; Reception stays in Rooms.
    const { options } = read({
      now: NOV_18,
      portals: [
        portal('Reception', '2026-10-01', { portalGroupId: 'group-rooms' }),
        portal('Spa', '2026-10-01', { portalGroupId: 'group-wellness' }),
      ],
      counts: {
        days: [
          ...readings('portal-reception', 'portal_rating_count', days('2026-10-21', 14)),
          ...readings('portal-spa', 'portal_rating_count', days('2026-10-21', 28)),
        ],
        groupDays: [
          ...groupDays('group-rooms', ['2026-11-03', '2026-11-09']),
          ...groupDays('group-rooms', ['2026-11-12']),
          ...groupDays('group-wellness', ['2026-11-10', '2026-11-15'], 2),
        ],
      },
      subjectNames: {
        'portal_group:group-rooms': 'Rooms',
        'portal_group:group-wellness': 'Wellness',
      },
    })

    const { groups } = await options

    // Rooms: Spa's Nov 3 and 9 and Reception's Nov 12; Wellness: Spa's since the 10th.
    expect(groups.map(({ name, soFar }) => [name, soFar])).toEqual([
      ['Rooms', 3],
      ['Wellness', 4],
    ])
    // The rate is the members' now: Spa's (28 in 28 days) is Wellness's, not Rooms'.
    const [rooms, wellness] = groups
    expect(rooms?.choices?.usual).toBeLessThan(wellness?.choices?.usual ?? 0)
  })

  it('one portal and each portal need 2 or more live portals', async () => {
    const one = await read({ portals: [portal('Reception', '2026-10-01')] }).options
    const two = await read({
      portals: [portal('Reception', '2026-10-01'), portal('Spa', '2026-10-15')],
    }).options

    expect([one.onePortal, one.eachPortal]).toEqual([[], []])
    expect(two.onePortal.map(({ name }) => name)).toEqual(['Reception', 'Spa'])
    expect(two.eachPortal).toHaveLength(2)
  })

  it('a new portal is unticked with the day it is ready', async () => {
    // Oct 17: Spa, live Oct 15, has 2 of its 14 days and joins on Oct 29.
    const { options } = read({
      portals: [portal('Reception', '2026-09-01'), portal('Spa', '2026-10-15')],
      counts: {
        days: readings('portal-reception', 'portal_rating_count', days('2026-09-20', 20)),
      },
    })

    const { eachPortal } = await options

    expect(eachPortal[1]).toMatchObject({
      offer: { name: 'Spa', readyOn: '2026-10-29', choices: null },
      ticked: false,
      number: null,
    })
  })

  it('a portal with a goal has it, and is not ticked', async () => {
    const { options } = read({
      now: NOV_22,
      portals: [portal('Reception', '2026-10-01'), portal('Spa', '2026-10-01')],
      counts: {
        days: readings('portal-reception', 'portal_rating_count', days('2026-10-25', 28)),
      },
      programs: [portalGoal('goal-reception', 'portal-reception')],
    })

    const { onePortal, eachPortal } = await options

    expect(onePortal[0]?.heldBy).toEqual({
      programId: 'goal-reception',
      name: 'Reception · Private ratings',
    })
    expect(eachPortal[0]).toMatchObject({ ticked: false })
  })

  it('the average opens at 10 private ratings in the last 4 weeks', async () => {
    const nine = await read({
      portals: [portal('Reception', '2026-09-01')],
      counts: {
        days: readings('portal-reception', 'portal_rating_count', days('2026-09-25', 9)),
      },
    }).options
    const ten = await read({
      portals: [portal('Reception', '2026-09-01')],
      counts: {
        days: readings('portal-reception', 'portal_rating_count', days('2026-09-25', 10)),
      },
    }).options

    expect(nine.average).toEqual({ available: false, last4Weeks: 9, heldBy: null })
    expect(ten.average).toMatchObject({ available: true, last4Weeks: 10 })
  })

  it('asks goal.create before reading anything', async () => {
    const { calls, deps, options } = read({
      portals: [portal('Reception', '2026-10-01')],
    })

    await options

    expect(calls[0]).toBe('authorize')
    expect(deps.policy.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'goal.create', propertyId: PROPERTY_ID }),
    )
  })
})
