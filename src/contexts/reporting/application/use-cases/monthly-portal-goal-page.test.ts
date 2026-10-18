import { describe, expect, it } from 'vitest'
import type { GoalProgramBundle } from '../ports/goal-program.repository'
import { GoalProgramError } from './goal-program-shared'
import {
  readMonthlyPortalGoalPage,
  type MonthlyPortalGoalPageDeps,
} from './monthly-portal-goal-page'
import {
  AT_NOON,
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
  withNextVersion,
} from './monthly-portal-goal-test-fixtures'

const read = (deps: MonthlyPortalGoalPageDeps) =>
  readMonthlyPortalGoalPage(deps, { propertyId: PROPERTY_ID }, actor)

/** Sofia's month starts (UTC+3 until Oct 25, then UTC+2). */
const OCT_1 = new Date('2026-09-30T21:00:00.000Z')
const JAN_1 = new Date('2026-12-31T22:00:00.000Z')
const DEC_22 = new Date('2026-12-22T10:00:00.000Z')
const NOV_12 = new Date('2026-11-12T09:00:00.000Z')
const NOV_20 = new Date('2026-11-20T09:00:00.000Z')

/** A month's result once it has closed: met or not against its own number. */
const closed = (start: Date, end: Date, value: number, target = 40) =>
  ({
    start,
    end,
    status: 'closed',
    evaluation: {
      state: 'eligible',
      value,
      sampleCount: value,
      achieved: value >= target,
      reason: null,
    },
  }) as const

/** A goal that is not a Property count goal: one Portal's own number. */
function portalGoal(id: string): GoalProgramBundle {
  const base = propertyGoal(id, 'portal_rating_count', { status: 'active' })
  return {
    ...base,
    program: { ...base.program, name: 'Reception goal' },
    assignments: base.assignments.map((assignment) => ({
      ...assignment,
      subject: { kind: 'portal', portalId: 'portal-reception' },
    })),
  }
}

describe('readMonthlyPortalGoalPage', () => {
  it('asks for goal.create before anything is read', async () => {
    const { deps, calls } = fakeWorld({ programs: [runningGoal()] })
    deps.policy.authorize.mockRejectedValueOnce(new GoalProgramError('forbidden'))

    await expect(read(deps)).rejects.toMatchObject({ code: 'forbidden' })
    expect(deps.policy.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'goal.create', propertyId: PROPERTY_ID }),
    )
    // The refusal came first: nothing was read.
    expect(calls).toEqual([])
  })

  it('with no goal: the card before one, and no months or changes', async () => {
    const { deps } = fakeWorld({ portals: SEAVIEW_PORTALS })

    const page = await read(deps)

    expect(page.card.state).toBe('getting_ready')
    expect(page).toMatchObject({
      timezone: 'Europe/Sofia',
      portals: ['Reception', 'Restaurant', 'Spa'],
      tiles: null,
      rows: null,
      months: [],
      changes: [],
      anyMonthClosed: false,
    })
  })

  it('months follow the line of succession across a stop', async () => {
    // Dec 22: the first goal counted October (met, 41 of 40) and November (not
    // met, 36 of 40); it was stopped on Nov 12 and counted to Nov 30. The goal
    // set after it counts 45 from December, 12 so far.
    const first = propertyGoal('first', 'portal_rating_count', {
      status: 'ended',
      from: OCT_1,
      until: DEC_1,
      endedAt: NOV_12,
      endedBy: 'elena',
      months: [closed(OCT_1, NOV_1, 41), closed(NOV_1, DEC_1, 36)],
    })
    const second = propertyGoal('second', 'portal_rating_count', {
      status: 'active',
      from: DEC_1,
      createdAt: NOV_20,
      open: { start: DEC_1, end: JAN_1, target: 45 },
    })
    const { deps } = fakeWorld({
      now: DEC_22,
      portals: SEAVIEW_PORTALS,
      programs: [first, second],
      figures: { [DEC_1.toISOString()]: governed(12) },
    })

    const page = await read(deps)

    expect(page.months).toEqual([
      {
        key: '2026-12',
        measure: 'portal_rating_count',
        value: 12,
        target: 45,
        outcome: 'running',
        finalOn: '2027-01-02',
        correction: null,
      },
      {
        key: '2026-11',
        measure: 'portal_rating_count',
        value: 36,
        target: 40,
        outcome: 'not_met',
        finalOn: '2026-12-01',
        correction: null,
      },
      {
        key: '2026-10',
        measure: 'portal_rating_count',
        value: 41,
        target: 40,
        outcome: 'met',
        finalOn: '2026-11-01',
        correction: null,
      },
    ])
    expect(page.anyMonthClosed).toBe(true)
    // The month before December is the first goal's November.
    expect(page.tiles?.lastMonth).toMatchObject({ key: '2026-11', outcome: 'not_met' })
  })

  it('a corrected month says when, and what it is now', async () => {
    const goal = propertyGoal('monthly', 'portal_rating_count', {
      status: 'active',
      from: OCT_1,
      months: [closed(OCT_1, NOV_1, 41), closed(NOV_1, DEC_1, 41)],
      open: { start: DEC_1, end: JAN_1 },
    })
    const corrected = {
      ...goal,
      results: goal.results.map((result) =>
        result.periodStart.getTime() === NOV_1.getTime()
          ? {
              ...result,
              revision: {
                id: 'revision-1',
                number: 1,
                changeReason: 'metric_correction_reconciliation',
                createdAt: new Date('2026-12-05T09:00:00.000Z'),
              },
            }
          : result,
      ),
    }
    const { deps } = fakeWorld({ now: DEC_22, programs: [corrected] })

    const page = await read(deps)

    expect(page.months.find(({ key }) => key === '2026-11')?.correction).toEqual({
      on: '2026-12-05',
      value: 41,
      outcome: 'met',
    })
  })

  it('changes come from versions, month changes, stops and go-lives', async () => {
    // Set on Oct 23: 40 from November, as recommended. On Nov 20 November was
    // lowered to 38 with a note; on Nov 22 the goal switched to 55 scans from
    // December, and on Dec 5 it was stopped.
    const base = propertyGoal('monthly', 'portal_rating_count', {
      status: 'ended',
      until: DEC_1,
      endedAt: new Date('2026-12-05T09:00:00.000Z'),
      endedBy: 'marco',
      targetSource: 'recommended',
      months: [{ start: NOV_1, end: DEC_1, status: 'closed' }],
    })
    const switched = withNextVersion(
      base,
      {
        metric: 'qualified_scans',
        targetValue: 55,
        from: DEC_1,
        createdAt: NOV_22,
        targetSource: 'own',
        changeReason: 'Spa is closed for the winter',
      },
      [{ start: DEC_1, end: JAN_1 }],
    )
    const november = switched.results[0]
    if (!november) throw new Error('expected November')
    const goal = {
      ...switched,
      targetChanges: [
        {
          id: 'change-1',
          organizationId: 'org-1',
          propertyId: PROPERTY_ID,
          programId: 'monthly',
          monthlyResultId: november.id,
          changeId: 'change-1',
          previousTargetValue: 40,
          newTargetValue: 38,
          followingOutcome: 'not_requested',
          followingReason: null,
          followingVersionId: null,
          note: 'Spa closed for a week',
          createdBy: 'elena',
          createdAt: NOV_20,
          targetSource: 'own',
        },
      ],
    } satisfies GoalProgramBundle
    const { deps } = fakeWorld({
      now: DEC_22,
      portals: SEAVIEW_PORTALS,
      programs: [goal],
    })

    const page = await read(deps)

    expect(page.changes).toEqual([
      { kind: 'stopped', on: '2026-12-05', by: 'marco' },
      {
        kind: 'set_from',
        on: '2026-11-22',
        by: 'elena',
        fromMonth: '2026-12',
        target: 55,
        measure: 'qualified_scans',
        switched: true,
        source: 'own',
        note: 'Spa is closed for the winter',
      },
      {
        kind: 'set_month',
        on: '2026-11-20',
        by: 'elena',
        month: '2026-11',
        target: 38,
        measure: 'portal_rating_count',
        source: 'own',
        note: 'Spa closed for a week',
      },
      {
        kind: 'set_from',
        on: '2026-10-23',
        by: 'elena',
        fromMonth: '2026-11',
        target: 40,
        measure: 'portal_rating_count',
        switched: false,
        source: 'recommended',
        note: null,
      },
      { kind: 'went_live', on: '2026-10-15', portals: ['Spa'] },
      { kind: 'went_live', on: '2026-10-09', portals: ['Reception', 'Restaurant'] },
    ])
  })

  it('a version that only changed subjects is no change of number', async () => {
    const base = propertyGoal('monthly', 'portal_rating_count', {
      status: 'active',
      until: DEC_1,
    })
    const same = withNextVersion(base, {
      targetValue: 40,
      from: DEC_1,
      changeReason: 'subjects_changed',
    })
    const { deps } = fakeWorld({ now: NOV_22, programs: [same] })

    const page = await read(deps)

    expect(page.changes.map(({ kind }) => kind)).toEqual(['set_from'])
  })

  it('the version a month change wrote for the months after it is that change', async () => {
    // Dec 1: December set to 45, and the months after it with it.
    const base = propertyGoal('monthly', 'portal_rating_count', {
      status: 'active',
      until: DEC_1,
      open: { start: DEC_1, end: JAN_1, target: 45 },
    })
    const following = withNextVersion(base, {
      targetValue: 45,
      from: JAN_1,
      createdAt: DEC_1,
      changeReason: 'target_changed',
    })
    const [december] = following.results
    if (!december) throw new Error('expected December')
    const goal = {
      ...following,
      targetChanges: [
        {
          id: 'change-1',
          organizationId: 'org-1',
          propertyId: PROPERTY_ID,
          programId: 'monthly',
          monthlyResultId: december.id,
          changeId: 'change-1',
          previousTargetValue: 40,
          newTargetValue: 45,
          followingOutcome: 'applied',
          followingReason: null,
          followingVersionId: following.version.id,
          note: null,
          createdBy: 'elena',
          createdAt: DEC_1,
          targetSource: 'recommended',
        },
      ],
    } satisfies GoalProgramBundle
    const { deps } = fakeWorld({ now: DEC_22, programs: [goal] })

    const page = await read(deps)

    expect(page.changes.map((change) => change.kind)).toEqual(['set_month', 'set_from'])
    expect(page.changes[0]).toMatchObject({
      month: '2026-12',
      target: 45,
      source: 'recommended',
    })
  })

  it('rows list every published portal and add up to the headline', async () => {
    // Nov 22: Reception 13, Restaurant 6, Spa 2 and 2 readings with no Portal.
    const { deps } = fakeWorld({
      now: NOV_22,
      portals: SEAVIEW_PORTALS,
      counts: {
        days: [
          ...readings('portal-reception', 'portal_rating_count', days('2026-11-01', 13)),
          ...readings('portal-restaurant', 'portal_rating_count', days('2026-11-02', 6)),
          ...readings('portal-spa', 'portal_rating_count', days('2026-11-10', 2)),
          ...readings(null, 'portal_rating_count', ['2026-11-05'], 2),
        ],
      },
      programs: [runningGoal()],
      figure: governed(23),
    })

    const page = await read(deps)

    expect(page.rows).toEqual({
      portals: [
        { portalId: 'portal-reception', name: 'Reception', count: 13 },
        { portalId: 'portal-restaurant', name: 'Restaurant', count: 6 },
        { portalId: 'portal-spa', name: 'Spa', count: 2 },
      ],
      elsewhere: 2,
      total: 23,
      truncated: false,
    })
  })

  it('no rows when they do not add up to the headline', async () => {
    const { deps } = fakeWorld({
      now: NOV_22,
      portals: SEAVIEW_PORTALS,
      counts: {
        days: readings('portal-reception', 'portal_rating_count', days('2026-11-01', 13)),
      },
      programs: [runningGoal()],
      figure: governed(14),
    })

    await expect(read(deps)).resolves.toMatchObject({ rows: null })
  })

  it('facts only for established portals', async () => {
    // Nov 22: Reception, live since Oct 9, had 42 scans in the basis and none
    // since Nov 14. Spa, live 10 days, had 20 scans and none since Nov 13: on
    // its own numbers as quiet, but not established.
    const { deps } = fakeWorld({
      now: NOV_22,
      portals: [portal('Reception', '2026-10-09'), portal('Spa', '2026-11-12')],
      counts: {
        days: [
          ...readings('portal-reception', 'qualified_scans', days('2026-10-25', 21), 2),
          ...readings('portal-spa', 'qualified_scans', days('2026-11-12', 2), 10),
        ],
        lastScanAt: new Map([
          ['portal-reception', new Date(`2026-11-14${AT_NOON}`)],
          ['portal-spa', new Date(`2026-11-13${AT_NOON}`)],
        ]),
      },
    })

    const page = await read(deps)

    expect(page.facts).toEqual({
      'portal-reception': { noScansSince: '2026-11-14', usualPerWeek: 11 },
    })
  })

  it('tiles say no goal for the month before the first, and the usual for this month', async () => {
    // Nov 22, the goal's first month. Reception and Restaurant have 4 weeks in
    // the basis with 32 private ratings: about 34 a 30-day month.
    const { deps } = fakeWorld({
      now: NOV_22,
      portals: [portal('Reception', '2026-10-09'), portal('Restaurant', '2026-10-09')],
      counts: {
        days: [
          ...readings('portal-reception', 'portal_rating_count', days('2026-10-25', 16)),
          ...readings('portal-restaurant', 'portal_rating_count', days('2026-10-26', 16)),
        ],
      },
      programs: [runningGoal()],
      figure: governed(23),
    })

    const page = await read(deps)

    expect(page.tiles).toEqual({
      lastMonth: { key: '2026-10', outcome: 'no_goal' },
      usual: { about: 34, weeks: 4 },
    })
  })

  it('a scheduled goal sets its tiles beside its first month', async () => {
    const { deps } = fakeWorld({
      now: OCT_23,
      portals: SEAVIEW_PORTALS,
      programs: [propertyGoal('monthly', 'portal_rating_count')],
    })

    const page = await read(deps)

    expect(page.tiles?.lastMonth).toEqual({ key: '2026-10', outcome: 'no_goal' })
    expect(page.months).toEqual([])
  })

  it('the other portal goals come with their month so far and their names', async () => {
    const { deps } = fakeWorld({
      now: NOV_22,
      portals: SEAVIEW_PORTALS,
      programs: [runningGoal(), portalGoal('reception')],
      figure: governed(9),
    })

    const page = await read(deps)

    expect(page.extras.goals.map(({ program }) => program.id)).toEqual(['reception'])
    expect(page.extras.progress).toEqual([
      expect.objectContaining({ programId: 'reception', subjectCount: 1 }),
    ])
    // A Portal the recommendation lists is named from it, not asked again.
    expect(page.extras.subjectNames).toEqual({ 'portal:portal-reception': 'Reception' })
    expect(deps.subjectNames.getSubjectName).not.toHaveBeenCalled()
  })

  it('names a group, or a Portal it does not list, by asking Portal', async () => {
    const group = portalGoal('rooms')
    const goal = {
      ...group,
      assignments: group.assignments.map((assignment) => ({
        ...assignment,
        subject: { kind: 'portal_group', portalGroupId: 'group-rooms' } as const,
      })),
    }
    const { deps } = fakeWorld({
      now: NOV_22,
      programs: [goal],
      subjectNames: { 'portal_group:group-rooms': 'Rooms' },
    })

    const page = await read(deps)

    expect(page.extras.subjectNames).toEqual({ 'portal_group:group-rooms': 'Rooms' })
  })
})
