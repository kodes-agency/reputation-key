import { describe, expect, it, vi } from 'vitest'
import type { GoalMetric } from '../../domain/goal-program'
import type {
  RecommendationDayCount,
  RecommendationPortal,
} from '../../domain/goal-recommendation-types'
import { setMonthlyPortalGoalSchema } from '../dto/monthly-portal-goal.dto'
import type { SetMonthlyPortalGoalRequest } from '../dto/monthly-portal-goal.types'
import type {
  GoalProgramBundle,
  GoalProgramVersion,
} from '../ports/goal-program.repository'
import type { GoalRecommendationFactsPort } from '../ports/goal-recommendation-facts.port'
import { GoalProgramError, type GoalActor } from './goal-program-shared'
import {
  MONTHLY_PORTAL_GOAL_NAME,
  changeMonthlyPortalGoalNow,
  keepMonthlyPortalGoal,
  reviseMonthlyPortalGoal,
  setMonthlyPortalGoal,
  stopMonthlyPortalGoal,
  type MonthlyPortalGoalChangeDeps,
  type MonthlyPortalGoalKeepDeps,
  type MonthlyPortalGoalSetDeps,
} from './monthly-portal-goal'
import { monthlyPortalGoalOf } from '../monthly-portal-goal-identity'
import { propertyGoal } from './monthly-portal-goal-test-fixtures'

const PROPERTY_ID = 'property-1'
const actor: GoalActor = {
  organizationId: 'org-1',
  userId: 'elena',
  role: 'PropertyManager',
}
// Seaview on Sofia time, Oct 23 (G1): Reception and Restaurant live since Oct 9
// with 11 and 5 private ratings, so November's recommended number is 40.
const OCT_23 = new Date('2026-10-23T09:00:00.000Z')
const AT_NOON = 'T09:00:00.000Z'

function portal(name: string, since: string): RecommendationPortal {
  const at = new Date(`${since}${AT_NOON}`)
  return {
    portalId: `portal-${name.toLowerCase()}`,
    name,
    publicationState: 'published',
    liveSince: at,
    liveIntervals: [{ from: at, to: null }],
    codeIssuedAt: at,
    codeReady: true,
    portalGroupId: null,
  }
}

const ratings = (portalId: string, first: string, count: number) =>
  Array.from({ length: count }, (_, index): RecommendationDayCount => ({
    portalId,
    measure: 'portal_rating_count',
    localDay: new Date(new Date(`${first}T00:00:00.000Z`).getTime() + index * 86_400_000)
      .toISOString()
      .slice(0, 10),
    count: 1,
  }))

/** An existing goal of the Property: its status, measure and subjects. */
function existing(
  id: string,
  shape: Readonly<{
    status?: GoalProgramBundle['program']['status']
    metric?: GoalMetric
    subject?: GoalProgramBundle['assignments'][number]['subject']
    /** When its first month begins: Nov 1 unless said. */
    from?: Date
    createdAt?: Date
  }> = {},
): GoalProgramBundle {
  const metric = shape.metric ?? 'portal_rating_count'
  const from = shape.from ?? new Date('2026-10-31T22:00:00.000Z')
  const version: GoalProgramVersion = {
    id: `${id}-v1`,
    programId: id,
    organizationId: 'org-1',
    propertyId: PROPERTY_ID,
    version: 1,
    metricDefinitionId: 'definition-1',
    metricDefinitionVersionId: 'definition-version-1',
    metric,
    metricMinimumSample: 0,
    targetValue: 40,
    propertyTimezone: 'Europe/Sofia',
    effectiveFrom: from,
    effectiveTo: null,
    changeReason: 'created',
    createdBy: 'elena',
    createdAt: OCT_23,
  }
  return {
    program: {
      id,
      organizationId: 'org-1',
      propertyId: PROPERTY_ID,
      name: 'A goal',
      description: null,
      status: shape.status ?? 'scheduled',
      statusReason: null,
      currentVersion: 1,
      createdBy: 'elena',
      createdAt: shape.createdAt ?? OCT_23,
      updatedAt: shape.createdAt ?? OCT_23,
    },
    version,
    versions: [version],
    assignments: [
      {
        id: `${id}-a1`,
        programId: id,
        programVersionId: version.id,
        organizationId: 'org-1',
        propertyId: PROPERTY_ID,
        metric,
        subject: shape.subject ?? { kind: 'property', propertyId: PROPERTY_ID },
        effectiveFrom: from,
        effectiveTo: null,
        createdBy: 'elena',
        createdAt: OCT_23,
      },
    ],
    results: [],
  }
}

/** The command over an in-memory Property, recording what it was asked in order. */
function fakeWorld(programs: readonly GoalProgramBundle[] = []) {
  const calls: string[] = []
  const facts = {
    listPortalReadiness: vi.fn(async () => ({
      portals: [portal('Reception', '2026-10-09'), portal('Restaurant', '2026-10-09')],
      truncated: false,
    })),
    readDailyCounts: vi.fn(async () => ({
      days: [
        ...ratings('portal-reception', '2026-10-09', 11),
        ...ratings('portal-restaurant', '2026-10-12', 5),
      ],
      unreadable: [],
      lastScanAt: new Map(),
      groupDays: [],
      groupUnreadable: [],
    })),
  } satisfies GoalRecommendationFactsPort
  const deps = {
    policy: {
      authorize: vi.fn(async () => {
        calls.push('authorize')
      }),
    },
    repository: {
      list: vi.fn(async () => {
        calls.push('programs')
        return programs
      }),
    },
    programs: {
      create: vi.fn(async () => {
        calls.push('create')
        return existing('created')
      }),
    },
    recommendation: {
      subjects: { getTimezone: vi.fn(async () => 'Europe/Sofia') },
      facts,
    },
    now: () => OCT_23,
  } satisfies MonthlyPortalGoalSetDeps
  return { deps, calls }
}

const NOVEMBER_40: SetMonthlyPortalGoalRequest = {
  propertyId: PROPERTY_ID,
  metric: 'portal_rating_count',
  targetValue: 40,
  startMonth: '2026-11',
  targetSource: 'recommended',
}

const created = (deps: MonthlyPortalGoalSetDeps) =>
  vi.mocked(deps.programs.create).mock.calls[0]?.[0]

describe('setMonthlyPortalGoal', () => {
  it('names the goal Monthly portal goal and gives it the Property alone', async () => {
    const { deps, calls } = fakeWorld()

    await expect(setMonthlyPortalGoal(deps, NOVEMBER_40, actor)).resolves.toMatchObject({
      program: { id: 'created' },
    })
    expect(MONTHLY_PORTAL_GOAL_NAME).toBe('Monthly portal goal')
    expect(deps.programs.create).toHaveBeenCalledWith(
      {
        propertyId: PROPERTY_ID,
        name: 'Monthly portal goal',
        description: null,
        metric: 'portal_rating_count',
        targetValue: 40,
        subjects: [{ kind: 'property', propertyId: PROPERTY_ID }],
        startMonth: '2026-11',
        targetSource: 'recommended',
      },
      actor,
    )
    // Asked first, and written last.
    expect(calls[0]).toBe('authorize')
    expect(calls.at(-1)).toBe('create')
    expect(deps.policy.authorize).toHaveBeenCalledWith({
      actor,
      organizationId: 'org-1',
      propertyId: PROPERTY_ID,
      action: 'goal.create',
    })
  })

  it('starts in the month the card named', async () => {
    const { deps } = fakeWorld()

    await setMonthlyPortalGoal(
      deps,
      { ...NOVEMBER_40, startMonth: '2026-10', targetValue: 24 },
      actor,
    )

    expect(created(deps)).toMatchObject({ startMonth: '2026-10', targetValue: 24 })
  })

  it('refuses an average', async () => {
    const { deps } = fakeWorld()
    const average = { ...NOVEMBER_40, metric: 'portal_rating_average' }

    expect(setMonthlyPortalGoalSchema.safeParse(average).success).toBe(false)
    await expect(
      setMonthlyPortalGoal(
        deps,
        average as unknown as SetMonthlyPortalGoalRequest,
        actor,
      ),
    ).rejects.toMatchObject({ code: 'invalid_target' })
    expect(deps.programs.create).not.toHaveBeenCalled()
  })

  it.each([
    ['private ratings', 'portal_rating_count', 'scheduled'],
    ['scans', 'qualified_scans', 'active'],
    ['scans, paused', 'qualified_scans', 'paused'],
  ] as const)(
    'refuses a second Property count goal on either measure as subject_has_goal (%s)',
    async (_label, metric, status) => {
      const { deps } = fakeWorld([existing('first', { metric, status })])

      await expect(setMonthlyPortalGoal(deps, NOVEMBER_40, actor)).rejects.toEqual(
        new GoalProgramError('subject_has_goal'),
      )
      expect(deps.programs.create).not.toHaveBeenCalled()
    },
  )

  it('leaves a stopped goal, an average and a Portal goal to the database rule', async () => {
    const { deps } = fakeWorld([
      existing('stopped', { status: 'ended' }),
      existing('average', { metric: 'portal_rating_average' }),
      existing('reception', {
        subject: { kind: 'portal', portalId: 'portal-reception' },
      }),
    ])

    await setMonthlyPortalGoal(deps, NOVEMBER_40, actor)

    expect(deps.programs.create).toHaveBeenCalledOnce()
  })

  it('records recommended when the number is the recommendation', async () => {
    const { deps } = fakeWorld()

    await setMonthlyPortalGoal(deps, NOVEMBER_40, actor)

    expect(created(deps)?.targetSource).toBe('recommended')
    expect(deps.recommendation.facts.listPortalReadiness).toHaveBeenCalledWith(
      'org-1',
      PROPERTY_ID,
      OCT_23,
    )
  })

  it.each([
    ['another number', { targetValue: 45 }],
    ['the number of another month', { startMonth: '2026-10' }],
    ['the number of another measure', { metric: 'qualified_scans' }],
  ] as const)('records own for %s, whatever it was told', async (_label, change) => {
    const { deps } = fakeWorld()

    await setMonthlyPortalGoal(deps, { ...NOVEMBER_40, ...change }, actor)

    expect(created(deps)?.targetSource).toBe('own')
  })

  it('records own as told, without reading the recommendation', async () => {
    const { deps } = fakeWorld()

    await setMonthlyPortalGoal(deps, { ...NOVEMBER_40, targetSource: 'own' }, actor)

    expect(created(deps)?.targetSource).toBe('own')
    expect(deps.recommendation.facts.listPortalReadiness).not.toHaveBeenCalled()
  })

  it('a refused actor reads and writes nothing', async () => {
    const { deps, calls } = fakeWorld()
    deps.policy.authorize.mockRejectedValueOnce(new GoalProgramError('forbidden'))

    await expect(setMonthlyPortalGoal(deps, NOVEMBER_40, actor)).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(calls).toEqual([])
  })
})

describe('setMonthlyPortalGoalSchema', () => {
  const valid = {
    ...NOVEMBER_40,
    propertyId: '00000000-0000-4000-8000-000000000002',
  }

  it('takes one of the two measures, a whole number and a month', () => {
    expect(setMonthlyPortalGoalSchema.safeParse(valid).success).toBe(true)
    expect(
      setMonthlyPortalGoalSchema.safeParse({ ...valid, metric: 'qualified_scans' })
        .success,
    ).toBe(true)
  })

  it.each([
    ['no month', { startMonth: undefined }],
    ['a thirteenth month', { startMonth: '2026-13' }],
    ['a day', { startMonth: '2026-11-01' }],
    ['zero', { targetValue: 0 }],
    ['a fraction', { targetValue: 4.5 }],
    ['over a million', { targetValue: 1_000_001 }],
    ['another source', { targetSource: 'suggested' }],
    ['a Property that is not an id', { propertyId: 'p1' }],
  ])('refuses %s', (_label, change) => {
    expect(setMonthlyPortalGoalSchema.safeParse({ ...valid, ...change }).success).toBe(
      false,
    )
  })
})

// ─── Change number, Count scans instead, Stop (PLAN PG-14) ─────────────────

/** October on Sofia time: the month that runs on Oct 23. */
const OCT_1 = new Date('2026-09-30T21:00:00.000Z')
const NOV_1 = new Date('2026-10-31T22:00:00.000Z')

/** The monthly goal, running in October at 40, set on Oct 2. */
const runningOctober = () =>
  propertyGoal('monthly', 'portal_rating_count', {
    status: 'active',
    from: OCT_1,
    createdAt: new Date('2026-10-02T09:00:00.000Z'),
    open: { start: OCT_1, end: NOV_1 },
  })

/** The commands over an in-memory Property, with the engine's own commands faked. */
function changeWorld(
  programs: readonly GoalProgramBundle[] = [runningOctober()],
  now?: Date,
) {
  const { deps: setDeps, calls } = fakeWorld(programs)
  const deps = {
    policy: setDeps.policy,
    repository: setDeps.repository,
    recommendation: setDeps.recommendation,
    now: now === undefined ? setDeps.now : () => now,
    programs: {
      changeMonthTarget: vi.fn(async () => {
        calls.push('change month')
        return {
          month: { previous: 40, next: 45 },
          following: { outcome: 'applied' as const },
        }
      }),
      revise: vi.fn(async () => {
        calls.push('revise')
        return programs[0] ?? existing('revised')
      }),
      changeStatus: vi.fn(async () => {
        calls.push('stop')
        return (programs[0] ?? existing('stopped')).program
      }),
    },
  } satisfies MonthlyPortalGoalChangeDeps
  return { deps, calls }
}

const OCTOBER_45 = {
  propertyId: PROPERTY_ID,
  programId: 'monthly',
  month: '2026-10',
  targetValue: 45,
  expectedTarget: 40,
  expectedVersion: 1,
  expectedFollowingMonth: '2026-11',
  targetSource: 'own',
} as const

const FROM_NOVEMBER_45 = {
  propertyId: PROPERTY_ID,
  programId: 'monthly',
  metric: 'portal_rating_count',
  targetValue: 45,
  expectedVersion: 1,
  startMonth: '2026-11',
  targetSource: 'own',
} as const

const asked = (deps: MonthlyPortalGoalChangeDeps) =>
  vi.mocked(deps.policy.authorize).mock.calls.map(([request]) => request.action)

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

  it('refuses a goal that is not the monthly portal goal', async () => {
    const { deps } = changeWorld([
      runningOctober(),
      existing('reception', {
        subject: { kind: 'portal', portalId: 'portal-reception' },
      }),
    ])

    await expect(
      changeMonthlyPortalGoalNow(deps, { ...OCTOBER_45, programId: 'reception' }, actor),
    ).rejects.toEqual(new GoalProgramError('invalid_subject'))
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

  it.each([
    [
      'a goal for one Portal',
      existing('other', { subject: { kind: 'portal', portalId: 'portal-reception' } }),
    ],
    ['an average', existing('other', { metric: 'portal_rating_average' })],
    [
      'a second Property count goal, set after the monthly one',
      existing('other', { metric: 'qualified_scans', createdAt: OCT_23 }),
    ],
  ])(
    'revise refuses a goal that is not the monthly portal goal (%s)',
    async (_label, goal) => {
      const { deps } = changeWorld([runningOctober(), goal])

      await expect(
        reviseMonthlyPortalGoal(deps, { ...FROM_NOVEMBER_45, programId: 'other' }, actor),
      ).rejects.toEqual(new GoalProgramError('invalid_subject'))
      expect(deps.programs.revise).not.toHaveBeenCalled()
    },
  )

  it('a refused actor reads and writes nothing', async () => {
    const { deps, calls } = changeWorld()
    deps.policy.authorize.mockRejectedValueOnce(new GoalProgramError('forbidden'))

    await expect(
      reviseMonthlyPortalGoal(deps, FROM_NOVEMBER_45, actor),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(calls).toEqual([])
  })
})

describe('stopMonthlyPortalGoal', () => {
  const STOP = { propertyId: PROPERTY_ID, programId: 'monthly' } as const
  const DEC_1 = new Date('2026-11-30T22:00:00.000Z')
  const NOV_22 = new Date('2026-11-22T10:00:00.000Z')

  it('Stop keeps November and frees December', async () => {
    const running = propertyGoal('monthly', 'portal_rating_count', {
      status: 'active',
      open: { start: NOV_1, end: DEC_1 },
    })
    const { deps } = changeWorld([running], NOV_22)

    await stopMonthlyPortalGoal(deps, STOP, actor)

    expect(deps.programs.changeStatus).toHaveBeenCalledWith(
      { propertyId: PROPERTY_ID, programId: 'monthly', status: 'ended' },
      actor,
    )
    // As the engine leaves it: ended, its window closed where November ends,
    // November still open (integration: monthly-portal-goal-change).
    const stopped = propertyGoal('monthly', 'portal_rating_count', {
      status: 'ended',
      until: DEC_1,
      endedAt: new Date('2026-11-12T08:00:00.000Z'),
      open: { start: NOV_1, end: DEC_1 },
    })
    // It is still the monthly goal while November counts…
    expect(monthlyPortalGoalOf([stopped], NOV_22)?.program.id).toBe('monthly')
    // …and a goal from December is no second goal beside it.
    const next = fakeWorld([stopped])
    await setMonthlyPortalGoal(
      next.deps,
      { ...NOVEMBER_40, startMonth: '2026-12', targetSource: 'own' },
      actor,
    )
    expect(next.deps.programs.create).toHaveBeenCalledOnce()
  })

  it('Stop on a scheduled goal frees the month at once', async () => {
    const { deps } = changeWorld([existing('monthly')])

    await stopMonthlyPortalGoal(deps, STOP, actor)

    expect(deps.programs.changeStatus).toHaveBeenCalledOnce()
    // As the engine leaves it: ended with the empty window [Nov 1, Nov 1).
    const stopped = propertyGoal('monthly', 'portal_rating_count', {
      status: 'ended',
      until: NOV_1,
    })
    expect(monthlyPortalGoalOf([stopped], OCT_23)).toBeNull()
    const again = fakeWorld([stopped])
    await setMonthlyPortalGoal(again.deps, NOVEMBER_40, actor)
    expect(again.deps.programs.create).toHaveBeenCalledOnce()
  })

  it('ends the goal, asked goal.cancel', async () => {
    const { deps, calls } = changeWorld()

    await stopMonthlyPortalGoal(deps, STOP, actor)

    expect(deps.programs.changeStatus).toHaveBeenCalledWith(
      { propertyId: PROPERTY_ID, programId: 'monthly', status: 'ended' },
      actor,
    )
    expect(asked(deps)[0]).toBe('goal.cancel')
    expect(calls.at(-1)).toBe('stop')
  })

  it('a second Stop is invalid_transition', async () => {
    const stopped = propertyGoal('monthly', 'portal_rating_count', {
      status: 'ended',
      from: OCT_1,
      until: NOV_1,
      open: { start: OCT_1, end: NOV_1 },
    })
    const { deps } = changeWorld([stopped])

    // The engine would take ended to ended for a conflict: the dialog says the
    // goal was already stopped instead, and nothing is written.
    await expect(stopMonthlyPortalGoal(deps, STOP, actor)).rejects.toEqual(
      new GoalProgramError('invalid_transition'),
    )
    expect(deps.programs.changeStatus).not.toHaveBeenCalled()
  })

  it('refuses a goal that is not a Property count goal', async () => {
    const { deps } = changeWorld([
      existing('monthly', { subject: { kind: 'portal', portalId: 'portal-reception' } }),
    ])

    await expect(stopMonthlyPortalGoal(deps, STOP, actor)).rejects.toEqual(
      new GoalProgramError('invalid_subject'),
    )
    expect(deps.programs.changeStatus).not.toHaveBeenCalled()
  })

  it('a refused actor reads and writes nothing', async () => {
    const { deps, calls } = changeWorld()
    deps.policy.authorize.mockRejectedValueOnce(new GoalProgramError('forbidden'))

    await expect(stopMonthlyPortalGoal(deps, STOP, actor)).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(calls).toEqual([])
  })
})

// ─── The month-start check-in (PLAN PG-15) ─────────────────────────────────

describe('keepMonthlyPortalGoal', () => {
  const DEC_1 = new Date('2026-11-30T22:00:00.000Z')
  const JAN_1 = new Date('2026-12-31T22:00:00.000Z')
  /** Dec 3, noon in Sofia. */
  const DEC_3 = new Date('2026-12-03T10:00:00.000Z')
  const KEEP = {
    propertyId: PROPERTY_ID,
    programId: 'monthly',
    month: '2026-12',
  } as const

  /** Running since November at 40; November is being read, December has opened. */
  const runningDecember = () =>
    propertyGoal('monthly', 'portal_rating_count', {
      status: 'active',
      months: [
        { start: NOV_1, end: DEC_1, status: 'reconciling' },
        { start: DEC_1, end: JAN_1 },
      ],
    })

  /** Keep over an in-memory Property, with the engine's change commands watched. */
  function keepWorld(
    programs: readonly GoalProgramBundle[] = [runningDecember()],
    now: Date = DEC_3,
  ) {
    const { deps: change, calls } = changeWorld(programs, now)
    const deps = {
      policy: change.policy,
      repository: {
        list: change.repository.list,
        answerCheckIn: vi.fn(async () => {
          calls.push('answer')
          return true
        }),
      },
      now: change.now,
    } satisfies MonthlyPortalGoalKeepDeps
    return { deps, calls, change }
  }

  it('Keep writes the answered month without a version bump', async () => {
    const { deps, calls, change } = keepWorld()

    await expect(keepMonthlyPortalGoal(deps, KEEP, actor)).resolves.toEqual({
      month: '2026-12',
    })

    expect(deps.repository.answerCheckIn).toHaveBeenCalledWith({
      organizationId: 'org-1',
      propertyId: PROPERTY_ID,
      programId: 'monthly',
      month: '2026-12',
    })
    // No version and no change row: none of the engine's commands runs.
    expect(change.programs.changeMonthTarget).not.toHaveBeenCalled()
    expect(change.programs.revise).not.toHaveBeenCalled()
    expect(change.programs.changeStatus).not.toHaveBeenCalled()
    expect(asked(change)).toEqual(['goal.update'])
    expect(calls).toEqual(['authorize', 'programs', 'answer'])
  })

  it('Keep twice is idempotent', async () => {
    const { deps } = keepWorld()

    await keepMonthlyPortalGoal(deps, KEEP, actor)
    await expect(keepMonthlyPortalGoal(deps, KEEP, actor)).resolves.toEqual({
      month: '2026-12',
    })

    expect(vi.mocked(deps.repository.answerCheckIn).mock.calls).toEqual([
      [
        {
          organizationId: 'org-1',
          propertyId: PROPERTY_ID,
          programId: 'monthly',
          month: '2026-12',
        },
      ],
      [
        {
          organizationId: 'org-1',
          propertyId: PROPERTY_ID,
          programId: 'monthly',
          month: '2026-12',
        },
      ],
    ])
  })

  it('Keep on day 8 is check_in_closed', async () => {
    // 23:59 on Dec 7 in Sofia is the check-in's last minute; midnight closes it.
    const lastMinute = keepWorld(
      [runningDecember()],
      new Date('2026-12-07T21:59:00.000Z'),
    )
    const day8 = keepWorld([runningDecember()], new Date('2026-12-07T22:00:00.000Z'))

    await expect(keepMonthlyPortalGoal(lastMinute.deps, KEEP, actor)).resolves.toEqual({
      month: '2026-12',
    })
    await expect(keepMonthlyPortalGoal(day8.deps, KEEP, actor)).rejects.toEqual(
      new GoalProgramError('check_in_closed'),
    )
    expect(day8.deps.repository.answerCheckIn).not.toHaveBeenCalled()
  })

  it('a month that is not the one running is check_in_closed', async () => {
    // A card read on Nov 7, pressed on Dec 3.
    const { deps } = keepWorld()

    await expect(
      keepMonthlyPortalGoal(deps, { ...KEEP, month: '2026-11' }, actor),
    ).rejects.toEqual(new GoalProgramError('check_in_closed'))
    expect(deps.repository.answerCheckIn).not.toHaveBeenCalled()
  })

  it('a stopped goal takes no Keep', async () => {
    // Stopped on Dec 2: December still counts, and there is nothing to keep.
    const stopped = propertyGoal('monthly', 'portal_rating_count', {
      status: 'ended',
      until: JAN_1,
      endedAt: new Date('2026-12-02T08:00:00.000Z'),
      months: [
        { start: NOV_1, end: DEC_1, status: 'reconciling' },
        { start: DEC_1, end: JAN_1 },
      ],
    })
    const { deps } = keepWorld([stopped])

    await expect(keepMonthlyPortalGoal(deps, KEEP, actor)).rejects.toEqual(
      new GoalProgramError('invalid_transition'),
    )
    expect(deps.repository.answerCheckIn).not.toHaveBeenCalled()
  })

  it('a goal stopped while Keep was on its way is invalid_transition', async () => {
    const { deps } = keepWorld()
    deps.repository.answerCheckIn.mockResolvedValueOnce(false)

    await expect(keepMonthlyPortalGoal(deps, KEEP, actor)).rejects.toEqual(
      new GoalProgramError('invalid_transition'),
    )
  })

  it('refuses a goal that is not the monthly portal goal', async () => {
    const { deps } = keepWorld([
      runningDecember(),
      existing('reception', {
        subject: { kind: 'portal', portalId: 'portal-reception' },
      }),
    ])

    await expect(
      keepMonthlyPortalGoal(deps, { ...KEEP, programId: 'reception' }, actor),
    ).rejects.toEqual(new GoalProgramError('invalid_subject'))
    expect(deps.repository.answerCheckIn).not.toHaveBeenCalled()
  })

  it('a refused actor reads and writes nothing', async () => {
    const { deps, calls } = keepWorld()
    deps.policy.authorize.mockRejectedValueOnce(new GoalProgramError('forbidden'))

    await expect(keepMonthlyPortalGoal(deps, KEEP, actor)).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(calls).toEqual([])
  })
})

describe("the check-in's Use", () => {
  // Reception and Restaurant live since Oct 9 with 11 and 5 private ratings.
  // Nov 3 in Sofia: 16 in 25 live days at each, so a whole 30-day November is
  // 20 · 22 · 24 (22 recommended), and the rest of it, with nothing in yet,
  // 18 · 20 · 22 (20 recommended). The check-in offers what the sheet does.
  const NOV_3 = new Date('2026-11-03T10:00:00.000Z')
  const DEC_1 = new Date('2026-11-30T22:00:00.000Z')
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
