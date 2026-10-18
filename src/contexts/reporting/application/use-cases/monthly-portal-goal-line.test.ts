import { describe, expect, it } from 'vitest'
import type { GoalProgramBundle } from '../ports/goal-program.repository'
import {
  readMonthlyPortalGoalLine,
  type MonthlyPortalGoalLineDeps,
} from './monthly-portal-goal-line'
import {
  NOV_22,
  PROPERTY_ID,
  SEAVIEW_PORTALS,
  actor,
  days,
  draft,
  fakeWorld,
  governed,
  portal,
  portalGoal,
  propertyGoal,
  readings,
  runningGoal,
} from './monthly-portal-goal-test-fixtures'

const RECEPTION = 'portal-reception'

const lineOf = (deps: MonthlyPortalGoalLineDeps, portalId: string = RECEPTION) =>
  readMonthlyPortalGoalLine(deps, { propertyId: PROPERTY_ID, portalId }, actor)

// Nov 22 at Seaview: Reception 13, Restaurant 6 and Spa 2, and 2 readings with
// no Portal: 23, as the governed read says.
const NOVEMBER = [
  ...readings('portal-reception', 'portal_rating_count', days('2026-11-01', 13)),
  ...readings('portal-restaurant', 'portal_rating_count', days('2026-11-02', 6)),
  ...readings('portal-spa', 'portal_rating_count', days('2026-11-10', 2)),
  ...readings(null, 'portal_rating_count', ['2026-11-05'], 2),
]

describe('readMonthlyPortalGoalLine', () => {
  it("counts toward the monthly goal: the Portal's count of the month it counts", async () => {
    const { deps } = fakeWorld({
      now: NOV_22,
      portals: SEAVIEW_PORTALS,
      counts: { days: NOVEMBER },
      programs: [runningGoal()],
      figure: governed(23),
    })

    await expect(lineOf(deps)).resolves.toEqual({
      month: '2026-11',
      monthlyGoal: { measure: 'portal_rating_count', count: 13 },
      ownGoal: null,
    })
    await expect(lineOf(deps, 'portal-spa')).resolves.toMatchObject({
      monthlyGoal: { count: 2 },
    })
  })

  it("the Portal's own goal: its month so far against its number", async () => {
    const { deps } = fakeWorld({
      now: NOV_22,
      portals: SEAVIEW_PORTALS,
      counts: { days: NOVEMBER },
      programs: [runningGoal(), portalGoal('reception-goal', { target: 20 })],
      figure: governed(23),
      portalFigures: { [RECEPTION]: governed(14) },
    })

    await expect(lineOf(deps)).resolves.toEqual({
      month: '2026-11',
      monthlyGoal: { measure: 'portal_rating_count', count: 13 },
      ownGoal: {
        programId: 'reception-goal',
        measure: 'portal_rating_count',
        value: 14,
        target: 20,
      },
    })
    // Another Portal's own goal is not this one's.
    await expect(lineOf(deps, 'portal-restaurant')).resolves.toMatchObject({
      ownGoal: null,
    })
  })

  it('an own goal alone, with no monthly goal, still has its line', async () => {
    const { deps } = fakeWorld({
      now: NOV_22,
      portals: SEAVIEW_PORTALS,
      counts: { days: NOVEMBER },
      programs: [portalGoal('reception-goal')],
      portalFigures: { [RECEPTION]: governed(14) },
    })

    await expect(lineOf(deps)).resolves.toMatchObject({
      monthlyGoal: null,
      ownGoal: { value: 14, target: 20 },
    })
  })

  it('a draft gets no line, and neither does a Portal with no goal counting', async () => {
    const { deps } = fakeWorld({
      now: NOV_22,
      portals: [...SEAVIEW_PORTALS, draft('Bar')],
      counts: { days: NOVEMBER },
      programs: [runningGoal()],
      figure: governed(23),
    })
    const none = fakeWorld({ now: NOV_22, portals: SEAVIEW_PORTALS })

    await expect(lineOf(deps, 'portal-bar')).resolves.toBeNull()
    await expect(lineOf(none.deps)).resolves.toBeNull()
  })

  it('a Portal with nothing this month brings nothing in: no line, unless its own goal runs', async () => {
    const lobbyGoal = portalGoal('lobby-goal', { portalId: 'portal-lobby', target: 20 })
    const world = (programs: readonly GoalProgramBundle[]) =>
      fakeWorld({
        now: NOV_22,
        portals: [...SEAVIEW_PORTALS, portal('Lobby', '2026-10-09')],
        counts: { days: NOVEMBER },
        programs,
        figure: governed(23),
        portalFigures: { 'portal-lobby': governed(0) },
      }).deps

    await expect(lineOf(world([runningGoal()]), 'portal-lobby')).resolves.toBeNull()
    await expect(
      lineOf(world([runningGoal(), lobbyGoal]), 'portal-lobby'),
    ).resolves.toEqual({
      month: '2026-11',
      monthlyGoal: null,
      ownGoal: {
        programId: 'lobby-goal',
        measure: 'portal_rating_count',
        value: 0,
        target: 20,
      },
    })
  })

  it('a goal that has not started counts nothing yet: no line', async () => {
    const { deps } = fakeWorld({
      now: NOV_22,
      portals: SEAVIEW_PORTALS,
      counts: { days: NOVEMBER },
      programs: [
        propertyGoal('monthly', 'portal_rating_count', {
          from: new Date('2026-11-30T22:00:00.000Z'),
        }),
      ],
    })

    await expect(lineOf(deps)).resolves.toBeNull()
  })

  it("no count when the Portals' counts do not add up to the goal's figure", async () => {
    const { deps } = fakeWorld({
      now: NOV_22,
      portals: SEAVIEW_PORTALS,
      counts: { days: NOVEMBER },
      programs: [runningGoal()],
      figure: governed(24),
    })

    await expect(lineOf(deps)).resolves.toBeNull()
  })

  it('an own goal whose figure cannot be read says nothing of it', async () => {
    const { deps } = fakeWorld({
      now: NOV_22,
      portals: SEAVIEW_PORTALS,
      counts: { days: NOVEMBER },
      programs: [runningGoal(), portalGoal('reception-goal')],
      figure: governed(23),
      portalFigures: { [RECEPTION]: governed(null, 'unavailable') },
    })

    await expect(lineOf(deps)).resolves.toMatchObject({
      monthlyGoal: { count: 13 },
      ownGoal: null,
    })
  })

  it("a disabled Portal's readings still count toward the monthly goal", async () => {
    const { deps } = fakeWorld({
      now: NOV_22,
      portals: [
        portal('Lobby', '2026-10-09', { publicationState: 'disabled', liveSince: null }),
        portal('Reception', '2026-10-09'),
      ],
      counts: {
        days: [
          ...readings('portal-lobby', 'portal_rating_count', days('2026-11-01', 3)),
          ...readings('portal-reception', 'portal_rating_count', days('2026-11-01', 10)),
        ],
      },
      programs: [runningGoal()],
      figure: governed(13),
    })

    await expect(lineOf(deps, 'portal-lobby')).resolves.toMatchObject({
      monthlyGoal: { count: 3 },
    })
  })

  it('asks goal.create before anything is read', async () => {
    const { deps, calls } = fakeWorld({ now: NOV_22, portals: SEAVIEW_PORTALS })

    await lineOf(deps)

    expect(calls[0]).toBe('authorize')
    expect(deps.policy.authorize).toHaveBeenCalledWith({
      actor,
      organizationId: 'org-1',
      propertyId: PROPERTY_ID,
      action: 'goal.create',
    })
  })
})
