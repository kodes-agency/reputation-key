import { describe, expect, it } from 'vitest'
import { GoalProgramError } from '../application/use-cases/goal-program-shared'
import {
  changeMonthlyPortalGoalNow,
  reviseMonthlyPortalGoal,
} from './monthly-portal-goal.server'
import {
  DEC_1,
  NOV_1,
  OCT_23,
  PROPERTY_ID,
  actor,
  propertyGoal,
} from './monthly-portal-goal.test-fixtures'
import {
  FROM_NOVEMBER_45,
  OCT_1,
  OCTOBER_45,
  asked,
  changeWorld,
  existing,
  receptionSubject,
  runningOctober,
  severalSubjects,
} from './monthly-portal-goal-commands.test-fixtures'

describe('changeMonthlyPortalGoalNow', () => {
  it('the last day still changes now', async () => {
    // 23:30 on Oct 31 in Sofia: October's last half hour; it locks once it has ended.
    const { deps } = changeWorld([runningOctober()], new Date('2026-10-31T21:30:00.000Z'))

    await changeMonthlyPortalGoalNow(deps, OCTOBER_45, actor)

    expect(deps.programs.changeMonthTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        month: '2026-10',
        targetValue: 45,
        applyToFollowing: true,
      }),
      actor,
    )
  })

  it('change now judges this month and the next against the new number', async () => {
    const { deps, calls } = changeWorld()

    await changeMonthlyPortalGoalNow(deps, { ...OCTOBER_45, note: 'Spa reopened' }, actor)

    expect(deps.programs.changeMonthTarget).toHaveBeenCalledWith(
      {
        propertyId: PROPERTY_ID,
        programId: 'monthly',
        month: '2026-10',
        targetValue: 45,
        expectedTarget: 40,
        expectedVersion: 1,
        expectedFollowingMonth: '2026-11',
        // The months after take the new number too: always, from this sheet.
        applyToFollowing: true,
        note: 'Spa reopened',
        targetSource: 'own',
      },
      actor,
    )
    expect(asked(deps)[0]).toBe('goal.update')
    expect(calls[0]).toBe('authorize')
    expect(calls.at(-1)).toBe('change month')
  })

  it("records recommended only for this month's recommended number", async () => {
    // Oct 23 at Seaview: 16 so far, 16 in 14 days at two Portals, 9 days left
    // with today, so 27 · 28 · 29 for the rest of October.
    const recommended = changeWorld()
    const other = changeWorld()

    await changeMonthlyPortalGoalNow(
      recommended.deps,
      { ...OCTOBER_45, targetValue: 28, targetSource: 'recommended' },
      actor,
    )
    await changeMonthlyPortalGoalNow(
      other.deps,
      { ...OCTOBER_45, targetValue: 29, targetSource: 'recommended' },
      actor,
    )

    expect(recommended.deps.programs.changeMonthTarget).toHaveBeenCalledWith(
      expect.objectContaining({ targetValue: 28, targetSource: 'recommended' }),
      actor,
    )
    expect(other.deps.programs.changeMonthTarget).toHaveBeenCalledWith(
      expect.objectContaining({ targetValue: 29, targetSource: 'own' }),
      actor,
    )
  })

  it('changes a goal for one portal now, with its own recommended number', async () => {
    // Reception's own 11 in 14 days, 11 so far in October with 9 days left
    // with today: 19 · 20 · 21 for the rest of October.
    const goal = runningOctober('reception', receptionSubject)
    const recommended = changeWorld([runningOctober(), goal])
    const property = changeWorld([runningOctober(), goal])
    const input = {
      ...OCTOBER_45,
      programId: 'reception',
      targetSource: 'recommended',
    } as const

    await changeMonthlyPortalGoalNow(
      recommended.deps,
      { ...input, targetValue: 20 },
      actor,
    )
    // The Property's own recommended number for October is not Reception's.
    await changeMonthlyPortalGoalNow(property.deps, { ...input, targetValue: 28 }, actor)

    expect(recommended.deps.programs.changeMonthTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        programId: 'reception',
        targetValue: 20,
        targetSource: 'recommended',
      }),
      actor,
    )
    expect(property.deps.programs.changeMonthTarget).toHaveBeenCalledWith(
      expect.objectContaining({ targetValue: 28, targetSource: 'own' }),
      actor,
    )
  })

  it('changes the average now to its own level in tenths, never a recommended one', async () => {
    const average = propertyGoal('average', 'portal_rating_average', {
      status: 'active',
      from: OCT_1,
      open: { start: OCT_1, end: NOV_1 },
    })
    const { deps } = changeWorld([runningOctober(), average])

    await changeMonthlyPortalGoalNow(
      deps,
      {
        ...OCTOBER_45,
        programId: 'average',
        targetValue: 4.6,
        expectedTarget: 4.5,
        targetSource: 'recommended',
      },
      actor,
    )

    expect(deps.programs.changeMonthTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        programId: 'average',
        month: '2026-10',
        targetValue: 4.6,
        applyToFollowing: true,
        targetSource: 'own',
      }),
      actor,
    )
    // There is no recommended average: none is read.
    expect(deps.recommendation.facts.listPortalReadiness).not.toHaveBeenCalled()
  })

  it.each([
    ['a goal for several subjects', severalSubjects('other')],
    [
      'a second Property count goal, set after the monthly one',
      existing('other', { metric: 'qualified_scans', createdAt: OCT_23 }),
    ],
  ])('refuses a goal it does not change (%s)', async (_label, goal) => {
    const { deps } = changeWorld([runningOctober(), goal])

    await expect(
      changeMonthlyPortalGoalNow(deps, { ...OCTOBER_45, programId: 'other' }, actor),
    ).rejects.toEqual(new GoalProgramError('invalid_subject'))
    expect(deps.programs.changeMonthTarget).not.toHaveBeenCalled()
  })

  it('answers not_found for a goal that is not among the Property goals', async () => {
    const { deps } = changeWorld([runningOctober()])

    await expect(
      changeMonthlyPortalGoalNow(deps, { ...OCTOBER_45, programId: 'elsewhere' }, actor),
    ).rejects.toEqual(new GoalProgramError('not_found'))
    expect(deps.programs.changeMonthTarget).not.toHaveBeenCalled()
  })

  it('a refused actor reads and writes nothing', async () => {
    const { deps, calls } = changeWorld()
    deps.policy.authorize.mockRejectedValueOnce(new GoalProgramError('forbidden'))

    await expect(
      changeMonthlyPortalGoalNow(deps, OCTOBER_45, actor),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(calls).toEqual([])
  })
})

describe('reviseMonthlyPortalGoal', () => {
  it('From Dec 1 revises from next month', async () => {
    const { deps, calls } = changeWorld()

    await reviseMonthlyPortalGoal(deps, { ...FROM_NOVEMBER_45, note: 'Winter' }, actor)

    expect(deps.programs.revise).toHaveBeenCalledWith(
      {
        propertyId: PROPERTY_ID,
        programId: 'monthly',
        metric: 'portal_rating_count',
        targetValue: 45,
        // The Property alone, as the goal always counts it.
        subjects: [{ kind: 'property', propertyId: PROPERTY_ID }],
        expectedVersion: 1,
        // The month the sheet said: refused if the month turned since.
        expectedStartMonth: '2026-11',
        reason: 'Winter',
        targetSource: 'own',
      },
      actor,
    )
    expect(asked(deps)[0]).toBe('goal.update')
    expect(calls.at(-1)).toBe('revise')
  })

  it('a sheet read before the month turned is refused, never moved a month on', async () => {
    // Read on Oct 31 at 23:50 in Sofia ("From Nov 1"), sent at 00:05 on Nov 1:
    // the engine's start is December now, so it refuses the month the sheet said.
    const { deps } = changeWorld([runningOctober()], new Date('2026-10-31T22:05:00.000Z'))
    deps.programs.revise.mockRejectedValueOnce(
      new GoalProgramError('start_month_changed'),
    )

    await expect(
      reviseMonthlyPortalGoal(deps, FROM_NOVEMBER_45, actor),
    ).rejects.toMatchObject({ code: 'start_month_changed' })
    expect(deps.programs.revise).toHaveBeenCalledWith(
      expect.objectContaining({ expectedStartMonth: '2026-11' }),
      actor,
    )
  })

  it('Count scans instead revises from next month', async () => {
    const { deps } = changeWorld()

    await reviseMonthlyPortalGoal(
      deps,
      { ...FROM_NOVEMBER_45, metric: 'qualified_scans', targetValue: 55 },
      actor,
    )

    expect(deps.programs.revise).toHaveBeenCalledWith(
      expect.objectContaining({
        metric: 'qualified_scans',
        targetValue: 55,
        subjects: [{ kind: 'property', propertyId: PROPERTY_ID }],
      }),
      actor,
    )
    expect(deps.programs.changeMonthTarget).not.toHaveBeenCalled()
  })

  it('records recommended only for the recommended number of the month it starts', async () => {
    // A goal that starts on Nov 1 is changed from Nov 1: G1's 35 · 40 · 45.
    const scheduled = [existing('monthly')]
    const recommended = changeWorld(scheduled)
    const other = changeWorld(scheduled)

    await reviseMonthlyPortalGoal(
      recommended.deps,
      { ...FROM_NOVEMBER_45, targetValue: 40, targetSource: 'recommended' },
      actor,
    )
    await reviseMonthlyPortalGoal(
      other.deps,
      { ...FROM_NOVEMBER_45, metric: 'qualified_scans', targetSource: 'recommended' },
      actor,
    )

    expect(recommended.deps.programs.revise).toHaveBeenCalledWith(
      expect.objectContaining({ targetValue: 40, targetSource: 'recommended' }),
      actor,
    )
    // No scans came in: no number of that measure is recommended.
    expect(other.deps.programs.revise).toHaveBeenCalledWith(
      expect.objectContaining({ metric: 'qualified_scans', targetSource: 'own' }),
      actor,
    )
  })

  it('From Dec 1 on a goal for one portal keeps the portal its subject', async () => {
    // Reception's goal starts on Nov 1: changed from Nov 1, its own 24 · 26 · 29.
    const goal = existing('reception', { subject: receptionSubject })
    const recommended = changeWorld([goal])
    const property = changeWorld([goal])
    const input = {
      ...FROM_NOVEMBER_45,
      programId: 'reception',
      targetSource: 'recommended',
    } as const

    await reviseMonthlyPortalGoal(recommended.deps, { ...input, targetValue: 26 }, actor)
    await reviseMonthlyPortalGoal(property.deps, { ...input, targetValue: 40 }, actor)

    expect(recommended.deps.programs.revise).toHaveBeenCalledWith(
      expect.objectContaining({
        programId: 'reception',
        targetValue: 26,
        subjects: [receptionSubject],
        targetSource: 'recommended',
      }),
      actor,
    )
    // 40 is the Property's recommendation, not Reception's.
    expect(property.deps.programs.revise).toHaveBeenCalledWith(
      expect.objectContaining({ targetValue: 40, targetSource: 'own' }),
      actor,
    )
  })

  it('Count scans instead on a group goal keeps the group its subject', async () => {
    const rooms = { kind: 'portal_group', portalGroupId: 'group-rooms' } as const
    const { deps } = changeWorld([existing('rooms', { subject: rooms })])

    await reviseMonthlyPortalGoal(
      deps,
      {
        ...FROM_NOVEMBER_45,
        programId: 'rooms',
        metric: 'qualified_scans',
        targetValue: 12,
      },
      actor,
    )

    expect(deps.programs.revise).toHaveBeenCalledWith(
      expect.objectContaining({ metric: 'qualified_scans', subjects: [rooms] }),
      actor,
    )
  })

  it('From Dec 1 on the average changes its level, its own, and keeps its subject', async () => {
    const { deps } = changeWorld([
      existing('average', { metric: 'portal_rating_average' }),
    ])

    await reviseMonthlyPortalGoal(
      deps,
      {
        ...FROM_NOVEMBER_45,
        programId: 'average',
        metric: 'portal_rating_average',
        targetValue: 4.6,
        targetSource: 'recommended',
      },
      actor,
    )

    expect(deps.programs.revise).toHaveBeenCalledWith(
      expect.objectContaining({
        metric: 'portal_rating_average',
        targetValue: 4.6,
        subjects: [{ kind: 'property', propertyId: PROPERTY_ID }],
        targetSource: 'own',
      }),
      actor,
    )
  })

  it.each([
    ['the average to a count', 'average', 'portal_rating_average', 'qualified_scans'],
    [
      'a count to the average',
      'reception',
      'portal_rating_count',
      'portal_rating_average',
    ],
  ] as const)('never turns %s', async (_label, programId, metric, asked) => {
    const goal =
      metric === 'portal_rating_average'
        ? existing(programId, { metric })
        : existing(programId, { subject: receptionSubject })
    const { deps } = changeWorld([goal])

    await expect(
      reviseMonthlyPortalGoal(
        deps,
        { ...FROM_NOVEMBER_45, programId, metric: asked, targetValue: 4 },
        actor,
      ),
    ).rejects.toEqual(new GoalProgramError('invalid_target'))
    expect(deps.programs.revise).not.toHaveBeenCalled()
  })

  it.each([
    ['a goal for several subjects', severalSubjects('other')],
    [
      'a second Property count goal, set after the monthly one',
      existing('other', { metric: 'qualified_scans', createdAt: OCT_23 }),
    ],
  ])('revise refuses a goal it does not change (%s)', async (_label, goal) => {
    const { deps } = changeWorld([runningOctober(), goal])

    await expect(
      reviseMonthlyPortalGoal(deps, { ...FROM_NOVEMBER_45, programId: 'other' }, actor),
    ).rejects.toEqual(new GoalProgramError('invalid_subject'))
    expect(deps.programs.revise).not.toHaveBeenCalled()
  })

  it('a refused actor reads and writes nothing', async () => {
    const { deps, calls } = changeWorld()
    deps.policy.authorize.mockRejectedValueOnce(new GoalProgramError('forbidden'))

    await expect(
      reviseMonthlyPortalGoal(deps, FROM_NOVEMBER_45, actor),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(calls).toEqual([])
  })
})

describe("the check-in's Use", () => {
  // Reception and Restaurant live since Oct 9 with 11 and 5 private ratings.
  // Nov 3 in Sofia: 16 in 25 live days at each, so a whole 30-day November is
  // 20 · 22 · 24 (22 recommended), and the rest of it, with nothing in yet,
  // 18 · 20 · 22 (20 recommended). The check-in offers what the sheet does.
  const NOV_3 = new Date('2026-11-03T10:00:00.000Z')
  const runningNovember = () =>
    propertyGoal('monthly', 'portal_rating_count', {
      status: 'active',
      from: OCT_1,
      months: [
        { start: OCT_1, end: NOV_1, status: 'reconciling' },
        { start: NOV_1, end: DEC_1 },
      ],
    })
  const NOVEMBER_NOW = {
    ...OCTOBER_45,
    month: '2026-11',
    expectedFollowingMonth: '2026-12',
    targetSource: 'recommended',
  } as const
  /** What a change now to `targetValue`, claimed as recommended, is recorded as. */
  const recorded = async (now: Date, targetValue: number) => {
    const { deps } = changeWorld([runningNovember()], now)
    await changeMonthlyPortalGoalNow(deps, { ...NOVEMBER_NOW, targetValue }, actor)
    return deps.programs.changeMonthTarget
  }
  const as = (targetValue: number, targetSource: 'recommended' | 'own') =>
    [
      expect.objectContaining({ month: '2026-11', targetValue, targetSource }),
      actor,
    ] as const

  it('records recommended for the one number recommended for the rest of the month', async () => {
    // Use 20, as the sheet offers it; the whole month's 22 is a number of one's own.
    expect(await recorded(NOV_3, 20)).toHaveBeenCalledWith(...as(20, 'recommended'))
    expect(await recorded(NOV_3, 22)).toHaveBeenCalledWith(...as(22, 'own'))
    expect(await recorded(NOV_3, 21)).toHaveBeenCalledWith(...as(21, 'own'))
  })
})
