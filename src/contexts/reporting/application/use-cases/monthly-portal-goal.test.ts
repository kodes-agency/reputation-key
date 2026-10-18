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
  setMonthlyPortalGoal,
  type MonthlyPortalGoalSetDeps,
} from './monthly-portal-goal'

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
  }> = {},
): GoalProgramBundle {
  const metric = shape.metric ?? 'portal_rating_count'
  const from = new Date('2026-10-31T22:00:00.000Z')
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
      createdAt: OCT_23,
      updatedAt: OCT_23,
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
