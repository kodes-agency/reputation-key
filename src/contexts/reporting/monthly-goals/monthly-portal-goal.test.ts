import { describe, expect, it } from 'vitest'
import type { SetMonthlyPortalGoalRequest } from './contracts'
import { GoalProgramError } from '../application/use-cases/goal-program-shared'
import {
  MONTHLY_PORTAL_GOAL_NAME,
  setMonthlyPortalGoal,
  stopMonthlyPortalGoal,
} from './monthly-portal-goal.server'
import { monthlyPortalGoalOf } from './monthly-portal-goal-identity.server'
import { setMonthlyPortalGoalSchema } from './monthly-portal-goals.contracts'
import {
  DEC_1,
  NOV_1,
  NOV_22,
  OCT_23,
  PROPERTY_ID,
  actor,
  portal,
  propertyGoal,
} from './monthly-portal-goal.test-fixtures'
import {
  NOVEMBER_40,
  OCT_1,
  asked,
  changeWorld,
  created,
  existing,
  fakeWorld,
  receptionSubject,
  severalSubjects,
} from './monthly-portal-goal-commands.test-fixtures'

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

  it('records own as told while checking rating eligibility', async () => {
    const { deps } = fakeWorld()

    await setMonthlyPortalGoal(deps, { ...NOVEMBER_40, targetSource: 'own' }, actor)

    expect(created(deps)?.targetSource).toBe('own')
    expect(deps.recommendation.facts.listPortalReadiness).toHaveBeenCalled()
    expect(deps.recommendation.facts.readDailyCounts).not.toHaveBeenCalled()
  })

  it.each(['own', 'recommended'] as const)(
    'refuses %s rating targets when only unpublished siblings still collect ratings',
    async (targetSource) => {
      const { deps } = fakeWorld()
      deps.recommendation.facts.listPortalReadiness.mockResolvedValue({
        portals: [
          { ...portal('Reception', '2026-10-09'), skipPrivateRating: true },
          { ...portal('Restaurant', '2026-10-09'), publicationState: 'draft' },
        ],
      })

      await expect(
        setMonthlyPortalGoal(deps, { ...NOVEMBER_40, targetSource }, actor),
      ).rejects.toMatchObject({ code: 'private_ratings_skipped' })
      expect(deps.programs.create).not.toHaveBeenCalled()
    },
  )

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

// ─── Stop ─────────────────────────────────────────────────────

describe('stopMonthlyPortalGoal', () => {
  const STOP = { propertyId: PROPERTY_ID, programId: 'monthly' } as const

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

  it.each([
    ['a goal for one portal', existing('monthly', { subject: receptionSubject })],
    [
      'a goal for a group',
      existing('monthly', {
        subject: { kind: 'portal_group', portalGroupId: 'group-rooms' },
      }),
    ],
    ['the average', existing('monthly', { metric: 'portal_rating_average' })],
  ])('stops %s too', async (_label, goal) => {
    const { deps } = changeWorld([goal])

    await stopMonthlyPortalGoal(deps, STOP, actor)

    expect(deps.programs.changeStatus).toHaveBeenCalledWith(
      { propertyId: PROPERTY_ID, programId: 'monthly', status: 'ended' },
      actor,
    )
  })

  it('stops a goal for several subjects, made before goals had pages', async () => {
    const { deps } = changeWorld([severalSubjects('monthly')])

    await stopMonthlyPortalGoal(deps, STOP, actor)

    expect(deps.programs.changeStatus).toHaveBeenCalledWith(
      { propertyId: PROPERTY_ID, programId: 'monthly', status: 'ended' },
      actor,
    )
  })

  it('refuses a goal that names no subject: it has no page to stop it from', async () => {
    const goal = existing('monthly', { subject: receptionSubject })
    const { deps } = changeWorld([{ ...goal, assignments: [] }])

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
