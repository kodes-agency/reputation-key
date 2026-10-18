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
  reviseMonthlyPortalGoal,
  setMonthlyPortalGoal,
  stopMonthlyPortalGoal,
  type MonthlyPortalGoalChangeDeps,
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
        reason: 'Winter',
        targetSource: 'own',
      },
      actor,
    )
    expect(asked(deps)[0]).toBe('goal.update')
    expect(calls.at(-1)).toBe('revise')
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
