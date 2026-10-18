import { describe, expect, it } from 'vitest'
import type { GoalSubject } from '../../domain/goal-program'
import type { GoalProgramBundle } from '../ports/goal-program.repository'
import { GoalProgramError } from './goal-program-shared'
import type { GovernedGoalMetricResult } from './query-goal-metric'
import { readPortalGoalSinglePage } from './portal-goal-single-page'
import {
  DEC_1,
  NOV_1,
  NOV_22,
  OCT_23,
  PROPERTY_ID,
  SEAVIEW_PORTALS,
  actor,
  days,
  fakeWorld,
  governed,
  portal,
  propertyGoal,
  readings,
  runningGoal,
} from './monthly-portal-goal-test-fixtures'

const reception: GoalSubject = { kind: 'portal', portalId: 'portal-reception' }
const rooms: GoalSubject = { kind: 'portal_group', portalGroupId: 'group-rooms' }

/** Reception's own goal: 22 a month, running in November unless said. */
const receptionGoal = (shape: Parameters<typeof propertyGoal>[2] = {}) =>
  propertyGoal('reception-goal', 'portal_rating_count', {
    status: 'active',
    open: { start: NOV_1, end: DEC_1 },
    subject: reception,
    name: 'Reception · Private ratings',
    ...shape,
  })

/** The Property's average private rating, 4.5 in November; a month needs 10 ratings. */
function averageGoal(shape: Parameters<typeof propertyGoal>[2] = {}): GoalProgramBundle {
  const base = propertyGoal('average-goal', 'portal_rating_average', {
    status: 'active',
    open: { start: NOV_1, end: DEC_1 },
    name: 'Average private rating',
    ...shape,
  })
  const version = { ...base.version, targetValue: 4.5, metricMinimumSample: 10 }
  return { ...base, version, versions: [version] }
}

/** October on Sofia time. */
const OCT_1 = new Date('2026-09-30T21:00:00.000Z')

/** Reception's scans goal, open-ended from November. */
const receptionScans = () =>
  propertyGoal('reception-scans', 'qualified_scans', {
    status: 'active',
    open: { start: NOV_1, end: DEC_1 },
    subject: reception,
    name: 'Reception · Scans',
  })

/** A governed average: its figure and how many ratings it stands on. */
const average = (exactValue: number, sampleCount: number): GovernedGoalMetricResult => ({
  ...governed(exactValue),
  sampleCount,
  minimumSample: 10,
})

const read = (deps: ReturnType<typeof fakeWorld>['deps'], programId: string) =>
  readPortalGoalSinglePage(deps, { propertyId: PROPERTY_ID, programId }, actor)

describe('readPortalGoalSinglePage', () => {
  it('asks for goal.create before anything is read', async () => {
    const { deps, calls } = fakeWorld({ programs: [receptionGoal()] })
    deps.policy.authorize.mockRejectedValueOnce(new GoalProgramError('forbidden'))

    await expect(read(deps, 'reception-goal')).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(deps.policy.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'goal.create', propertyId: PROPERTY_ID }),
    )
    expect(calls).toEqual([])
  })

  it("a Property count goal is the Monthly portal goal: its page is the goal page's, and nothing more is read", async () => {
    const { deps, calls } = fakeWorld({ programs: [runningGoal()] })

    await expect(read(deps, 'monthly')).resolves.toEqual({ kind: 'monthly' })
    // The one Program, and no recommendation, no other goal and no figure.
    expect(calls).toEqual(['authorize', 'program'])
  })

  it('a goal it cannot see, or that is gone, is not found', async () => {
    const { deps } = fakeWorld({ programs: [receptionGoal()] })

    await expect(read(deps, 'nowhere')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('a goal for several subjects has a plain page: whom it counts by name, this month and its stop', async () => {
    const several = receptionGoal()
    const [window] = several.assignments
    if (!window) throw new Error('expected a window')
    const { deps } = fakeWorld({
      now: NOV_22,
      portals: SEAVIEW_PORTALS,
      programs: [
        {
          ...several,
          assignments: [
            window,
            { ...window, id: 'second', subject: rooms },
            {
              ...window,
              id: 'third',
              subject: { kind: 'portal', portalId: 'portal-spa' },
            },
          ],
        },
      ],
      figure: governed(7),
      subjectNames: { 'portal_group:group-rooms': 'Rooms' },
    })

    const view = await read(deps, 'reception-goal')

    expect(view).toMatchObject({
      kind: 'several',
      today: '2026-11-22',
      subjects: [
        { kind: 'portal', key: 'portal:portal-reception', name: 'Reception' },
        { kind: 'portal_group', key: 'portal_group:group-rooms', name: 'Rooms' },
        { kind: 'portal', key: 'portal:portal-spa', name: 'Spa' },
      ],
      goal: {
        programId: 'reception-goal',
        metric: 'portal_rating_count',
        status: 'active',
        target: 40,
        endedOn: null,
        // As its row on the Goals page says it: three subjects counting.
        live: { programId: 'reception-goal', subjectCount: 3, month: null },
        change: { nextMonthKey: '2026-12' },
      },
    })
  })

  it("a goal for one portal reads its own month, with no portals' rows", async () => {
    // Nov 22: Reception has 13 so far, against its own 40.
    const { deps } = fakeWorld({
      now: NOV_22,
      portals: SEAVIEW_PORTALS,
      counts: {
        days: [
          ...readings('portal-reception', 'portal_rating_count', days('2026-11-01', 13)),
          ...readings('portal-restaurant', 'portal_rating_count', days('2026-11-02', 6)),
        ],
      },
      programs: [runningGoal(), receptionGoal()],
      figure: governed(13),
    })

    const view = await read(deps, 'reception-goal')

    if (view.kind !== 'subject') throw new Error(`expected a subject, got ${view.kind}`)
    expect(view.subject).toEqual({
      kind: 'portal',
      key: 'portal:portal-reception',
      name: 'Reception',
    })
    // Reception holds no scans goal: "Count scans instead" stays.
    expect(view.otherMeasureHeld).toBe(false)
    const { card } = view.page
    if (card.state !== 'goal') throw new Error('expected the goal')
    expect(card.goal).toMatchObject({
      programId: 'reception-goal',
      month: { key: '2026-11', value: 13, target: 40, daysAfterToday: 8 },
      rows: null,
      newGoalFrom: null,
    })
    // The governed read was asked about Reception, never the Property.
    expect(deps.metrics.queryGoalMetric).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: { kind: 'portal', portalId: 'portal-reception' },
      }),
    )
    expect(view.page).toMatchObject({
      portals: [],
      rows: null,
      facts: {},
      extras: { goals: [], progress: [], subjectNames: {} },
      months: [
        expect.objectContaining({ key: '2026-11', value: 13, outcome: 'running' }),
      ],
    })
  })

  it('its usual, its offers and its go-live stand on its own numbers: 24 · 26 · 29 for November', async () => {
    // G1 on Oct 23, the goal set from November: Reception's own 11 in 14 days.
    const { deps } = fakeWorld({
      now: OCT_23,
      portals: SEAVIEW_PORTALS,
      counts: {
        days: [
          ...readings('portal-reception', 'portal_rating_count', days('2026-10-09', 11)),
          ...readings('portal-restaurant', 'portal_rating_count', days('2026-10-12', 5)),
        ],
      },
      programs: [receptionGoal({ status: 'scheduled', open: undefined })],
    })

    const view = await read(deps, 'reception-goal')

    if (view.kind !== 'subject') throw new Error(`expected a subject, got ${view.kind}`)
    const { page } = view
    expect(page.tiles).toEqual({
      lastMonth: { key: '2026-10', outcome: 'no_goal' },
      usual: { about: 24, weeks: 2 },
    })
    if (page.card.state !== 'goal') throw new Error('expected the goal')
    expect(page.card.goal.currentMonthSoFar).toBe(11)
    expect(page.card.sheet.offers.portal_rating_count.next?.choices).toEqual({
      usual: 24,
      aBitMore: 26,
      stretch: 29,
    })
    expect(page.card.sheet.offers.portal_rating_count.next?.basis.portals).toEqual([
      { name: 'Reception', count: 11, liveDays: 14 },
    ])
    // Only Reception went live for this goal; Restaurant and Spa are not its own.
    expect(page.changes).toEqual([
      expect.objectContaining({ kind: 'set_from', target: 40 }),
      { kind: 'went_live', on: '2026-10-09', portals: ['Reception'] },
    ])
  })

  it("a group's goal is named by Portal and stands on its members and its own month so far", async () => {
    const inRooms = { portalGroupId: 'group-rooms' }
    const { deps } = fakeWorld({
      now: NOV_22,
      portals: [
        portal('Reception', '2026-10-09', inRooms),
        portal('Restaurant', '2026-10-09', inRooms),
        portal('Spa', '2026-10-15'),
      ],
      counts: {
        days: [
          ...readings('portal-reception', 'portal_rating_count', days('2026-10-25', 16)),
          ...readings('portal-restaurant', 'portal_rating_count', days('2026-10-26', 16)),
        ],
        groupDays: days('2026-11-01', 9).map((localDay) => ({
          groupId: 'group-rooms',
          measure: 'portal_rating_count' as const,
          localDay,
          count: 2,
        })),
      },
      programs: [receptionGoal({ subject: rooms, name: 'Rooms · Private ratings' })],
      figure: governed(18),
      subjectNames: { 'portal_group:group-rooms': 'Rooms' },
    })

    const view = await read(deps, 'reception-goal')

    if (view.kind !== 'subject') throw new Error(`expected a subject, got ${view.kind}`)
    expect(view.subject).toEqual({
      kind: 'portal_group',
      key: 'portal_group:group-rooms',
      name: 'Rooms',
    })
    // 32 in 4 weeks at its two Portals: about 34 a 30-day month.
    expect(view.page.tiles?.usual).toEqual({ about: 34, weeks: 4 })
    if (view.page.card.state !== 'goal') throw new Error('expected the goal')
    // What the group has this month, as its readings were recorded.
    expect(view.page.card.sheet.ownNumber.current.soFar.ratings).toBe(18)
  })

  it('a portal Portal no longer lists has no usual and no offers, and is named by Portal', async () => {
    const { deps } = fakeWorld({
      now: NOV_22,
      portals: [portal('Restaurant', '2026-10-09')],
      programs: [receptionGoal()],
      figure: governed(4),
      subjectNames: { 'portal:portal-reception': 'Reception' },
    })

    const view = await read(deps, 'reception-goal')

    if (view.kind !== 'subject') throw new Error(`expected a subject, got ${view.kind}`)
    expect(view.subject).toEqual({
      kind: 'portal',
      key: 'portal:portal-reception',
      name: 'Reception',
    })
    expect(view.page.tiles?.usual).toBeNull()
    if (view.page.card.state !== 'goal') throw new Error('expected the goal')
    expect(view.page.card.sheet.offers.portal_rating_count).toEqual({
      current: null,
      next: null,
    })
    // Its month is still the governed read's.
    expect(view.page.card.goal.month?.value).toBe(4)
  })

  it('a portal that holds a scans goal from next month is offered no Count scans instead', async () => {
    const { deps } = fakeWorld({
      now: NOV_22,
      portals: SEAVIEW_PORTALS,
      programs: [receptionGoal(), receptionScans()],
      figure: governed(13),
    })

    const view = await read(deps, 'reception-goal')

    if (view.kind !== 'subject') throw new Error(`expected a subject, got ${view.kind}`)
    expect(view.otherMeasureHeld).toBe(true)
  })

  it("another portal's scans goal, or one that frees Reception before December, leaves the switch", async () => {
    const spaScans = propertyGoal('spa-scans', 'qualified_scans', {
      status: 'active',
      open: { start: NOV_1, end: DEC_1 },
      subject: { kind: 'portal', portalId: 'portal-spa' },
    })
    // Stopped in November: it holds Reception to Nov 30 only.
    const stopped = propertyGoal('reception-scans', 'qualified_scans', {
      status: 'ended',
      until: DEC_1,
      open: { start: NOV_1, end: DEC_1 },
      subject: reception,
    })
    const { deps } = fakeWorld({
      now: NOV_22,
      portals: SEAVIEW_PORTALS,
      programs: [receptionGoal(), spaScans, stopped],
      figure: governed(13),
    })

    const view = await read(deps, 'reception-goal')

    if (view.kind !== 'subject') throw new Error(`expected a subject, got ${view.kind}`)
    expect(view.otherMeasureHeld).toBe(false)
  })

  it('the average reads its month so far, or the ratings it still needs', async () => {
    const live = fakeWorld({
      now: NOV_22,
      portals: SEAVIEW_PORTALS,
      programs: [averageGoal()],
      figure: average(4.6, 12),
    })
    const thin = fakeWorld({
      now: NOV_22,
      portals: SEAVIEW_PORTALS,
      programs: [averageGoal()],
      figure: average(4.2, 6),
    })

    const shown = await read(live.deps, 'average-goal')
    const needsMore = await read(thin.deps, 'average-goal')

    expect(shown).toMatchObject({
      kind: 'average',
      subject: { kind: 'property' },
      today: '2026-11-22',
      goal: {
        programId: 'average-goal',
        status: 'active',
        target: 4.5,
        startsOn: null,
        month: {
          key: '2026-11',
          target: 4.5,
          daysAfterToday: 8,
          reading: { kind: 'live', value: 4.6, sampleCount: 12 },
        },
      },
    })
    expect(needsMore).toMatchObject({
      goal: {
        month: { reading: { kind: 'too_few', sampleCount: 6, minimumSample: 10 } },
      },
    })
  })

  it('the average reads no recommendation: its months and changes are its own', async () => {
    const { deps, calls } = fakeWorld({
      now: NOV_22,
      portals: SEAVIEW_PORTALS,
      programs: [
        averageGoal({
          from: OCT_1,
          months: [
            {
              start: OCT_1,
              end: NOV_1,
              status: 'closed',
              evaluation: {
                state: 'eligible',
                value: 4.6,
                sampleCount: 12,
                achieved: true,
              },
            },
          ],
        }),
      ],
      figure: average(4.4, 11),
    })

    const view = await read(deps, 'average-goal')

    if (view.kind !== 'average') throw new Error(`expected the average, got ${view.kind}`)
    expect(calls).not.toContain('portals')
    expect(calls).not.toContain('counts')
    expect(view.months).toEqual([
      expect.objectContaining({
        key: '2026-11',
        measure: 'portal_rating_average',
        value: 4.4,
        target: 4.5,
        outcome: 'running',
      }),
      expect.objectContaining({
        key: '2026-10',
        measure: 'portal_rating_average',
        value: 4.6,
        outcome: 'met',
      }),
    ])
    // The running month's figure is the one the tile has: read once.
    expect(calls.filter((call) => call === 'figure')).toHaveLength(1)
    expect(view.changes).toEqual([
      expect.objectContaining({
        kind: 'set_from',
        target: 4.5,
        measure: 'portal_rating_average',
        fromMonth: '2026-10',
      }),
    ])
    expect(view.goal).toMatchObject({ version: 1, endedOn: null })
  })

  it('a stopped average says the day it stopped, with no month to change', async () => {
    const { deps } = fakeWorld({
      now: NOV_22,
      portals: SEAVIEW_PORTALS,
      programs: [
        averageGoal({
          status: 'ended',
          until: DEC_1,
          endedAt: new Date('2026-11-12T10:00:00.000Z'),
          endedBy: 'elena',
        }),
      ],
      figure: average(4.6, 12),
    })

    const view = await read(deps, 'average-goal')

    expect(view).toMatchObject({
      kind: 'average',
      goal: { status: 'ended', endedOn: '2026-11-12', month: null, change: null },
      changes: [
        { kind: 'stopped', on: '2026-11-12', by: 'elena' },
        expect.objectContaining({ kind: 'set_from' }),
      ],
    })
  })

  it('a scheduled average says when it starts and reads no month', async () => {
    // Not started: no month of it is open yet.
    const { deps, calls } = fakeWorld({
      now: OCT_23,
      portals: SEAVIEW_PORTALS,
      programs: [averageGoal({ status: 'scheduled', open: undefined })],
    })

    const view = await read(deps, 'average-goal')

    expect(view).toMatchObject({
      kind: 'average',
      goal: { status: 'scheduled', startsOn: '2026-11-01', month: null },
    })
    expect(calls).not.toContain('figure')
  })
})
