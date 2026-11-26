// The Goal Program service on the real repository, against PostgreSQL: creating
// a goal, its start month, and rating goals on Portals that skip ratings.
//
// The harness and its savepoint scenario are in goal-program-service.test-fixtures.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { METRIC_VERSION_IDS } from '../readings/contracts'
import {
  actor,
  GROUP_ID,
  PROPERTY_ID,
  portalUuid,
  readiness,
  useGoalProgramsScenario,
} from './goal-program-service.test-fixtures'
import { GoalProgramError } from '../application/use-cases/goal-program-shared'

const { setup } = useGoalProgramsScenario()

describe('canonical Goal Program service', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('atomically creates one pinned program with many subjects and monthly results', async () => {
    const { service, repository } = setup()
    const bundle = await service.create(
      {
        propertyId: PROPERTY_ID,
        name: '  March ratings  ',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: [
          { kind: 'property', propertyId: PROPERTY_ID },
          { kind: 'portal_group', portalGroupId: GROUP_ID },
          { kind: 'portal', portalId: portalUuid(1) },
        ],
      },
      actor,
    )

    expect(bundle.program).toMatchObject({ name: 'March ratings', status: 'active' })
    expect(bundle.version).toMatchObject({
      metric: 'portal_rating_count',
      metricDefinitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
      metricMinimumSample: 0,
      targetValue: 25,
      effectiveFrom: new Date('2026-03-01T00:00:00.000Z'),
    })
    expect(bundle.assignments).toHaveLength(3)
    expect(bundle.results).toHaveLength(3)
    expect(bundle.results[0]).toMatchObject({
      periodStart: new Date('2026-03-01T00:00:00.000Z'),
      periodEnd: new Date('2026-04-01T00:00:00.000Z'),
      status: 'open',
    })
    expect(repository.create).toHaveBeenCalledOnce()
  })

  describe('start month', () => {
    const MARCH = {
      start: new Date('2026-03-01T00:00:00.000Z'),
      end: new Date('2026-04-01T00:00:00.000Z'),
    }
    const MID_MARCH = new Date('2026-03-15T12:00:00.000Z')
    const portalGoal = (startMonth?: string) =>
      ({
        propertyId: PROPERTY_ID,
        name: 'Ratings',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: [{ kind: 'portal', portalId: portalUuid(1) }],
        ...(startMonth === undefined ? {} : { startMonth }),
      }) as const

    it('create for the current month on 15 Mar is active with an open March row', async () => {
      const { service, repository, metrics } = setup(MID_MARCH)

      const bundle = await service.create(portalGoal('2026-03'), actor)

      expect(bundle.program).toMatchObject({ status: 'active', statusReason: null })
      expect(bundle.version).toMatchObject({
        effectiveFrom: MARCH.start,
        effectiveTo: null,
        createdAt: MID_MARCH,
      })
      expect(bundle.assignments).toEqual([
        expect.objectContaining({ effectiveFrom: MARCH.start, effectiveTo: null }),
      ])
      expect(bundle.results).toEqual([
        expect.objectContaining({
          periodStart: MARCH.start,
          periodEnd: MARCH.end,
          status: 'open',
          createdAt: MID_MARCH,
        }),
      ])
      // Readiness is asked about the month the goal counts, from its first day.
      expect(metrics.queryGoalMetric).toHaveBeenCalledWith(
        expect.objectContaining({ periodStart: MARCH.start, periodEnd: MARCH.end }),
      )
      expect(repository.create).toHaveBeenCalledWith({
        bundle,
        auditAction: 'goal.program.created',
      })
      // The hourly run finds March already open and adds nothing to it.
      await expect(service.maintain()).resolves.toMatchObject({
        activated: 0,
        scheduledResults: 0,
        failed: 0,
      })
      expect(repository.activate).not.toHaveBeenCalled()
      expect(repository.appendResults).not.toHaveBeenCalled()
    })

    it('create without a start month keeps the next-month schedule', async () => {
      const { service } = setup(MID_MARCH)

      const omitted = await service.create(portalGoal(), actor)

      expect(omitted.program).toMatchObject({
        status: 'scheduled',
        statusReason: 'awaiting_first_full_month',
      })
      expect(omitted.version.effectiveFrom).toEqual(MARCH.end)
      expect(omitted.results).toEqual([])
    })

    it('create for the next month is scheduled and waits for its first full month', async () => {
      const { service, metrics } = setup(MID_MARCH)

      const next = await service.create(portalGoal('2026-04'), actor)

      expect(next.program).toMatchObject({
        status: 'scheduled',
        statusReason: 'awaiting_first_full_month',
      })
      expect(next.version.effectiveFrom).toEqual(MARCH.end)
      expect(next.assignments[0]?.effectiveFrom).toEqual(MARCH.end)
      expect(next.results).toEqual([])
      expect(metrics.queryGoalMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          periodStart: MARCH.end,
          periodEnd: new Date('2026-05-01T00:00:00.000Z'),
        }),
      )
    })

    it('create refuses a subject that already has a live goal for the metric', async () => {
      const { service, repository } = setup(MID_MARCH)
      vi.mocked(repository.findAssignmentConflicts).mockResolvedValueOnce([
        {
          subject: { kind: 'portal', portalId: portalUuid(1) },
          programId: 'program-live',
          effectiveTo: null,
        },
      ])

      await expect(service.create(portalGoal('2026-03'), actor)).rejects.toMatchObject({
        code: 'subject_has_goal',
      } satisfies Partial<GoalProgramError>)

      // Asked from the month the new goal would start, about every Program.
      expect(repository.findAssignmentConflicts).toHaveBeenCalledWith({
        organizationId: actor.organizationId,
        propertyId: PROPERTY_ID,
        metric: 'portal_rating_count',
        effectiveFrom: MARCH.start,
        subjects: [{ kind: 'portal', portalId: portalUuid(1) }],
      })
      expect(repository.create).not.toHaveBeenCalled()
    })

    it('reports a conflict found only by the database as the same refusal', async () => {
      const { service, repository } = setup(MID_MARCH)
      vi.mocked(repository.create).mockResolvedValueOnce('subject_has_goal')

      await expect(service.create(portalGoal('2026-03'), actor)).rejects.toMatchObject({
        code: 'subject_has_goal',
      } satisfies Partial<GoalProgramError>)
    })

    it('a form opened on the last day and submitted after midnight is refused, not moved', async () => {
      // Opened on 31 March with "this month" (March) chosen; saved 30 seconds
      // into April. March is no longer a month a new goal can start in.
      const { service, repository, metrics } = setup(new Date('2026-04-01T00:00:30.000Z'))

      await expect(service.create(portalGoal('2026-03'), actor)).rejects.toMatchObject({
        code: 'start_month_changed',
      } satisfies Partial<GoalProgramError>)

      expect(metrics.queryGoalMetric).not.toHaveBeenCalled()
      expect(repository.findAssignmentConflicts).not.toHaveBeenCalled()
      expect(repository.create).not.toHaveBeenCalled()
    })

    it('reads the start month on the Property calendar, not the UTC one', async () => {
      // 22:30 UTC on 31 March is 01:30 on 1 April in Sofia.
      const { service, subjects } = setup(new Date('2026-03-31T22:30:00.000Z'))
      vi.mocked(subjects.getTimezone).mockResolvedValue('Europe/Sofia')

      await expect(service.create(portalGoal('2026-03'), actor)).rejects.toMatchObject({
        code: 'start_month_changed',
      })
      await expect(service.create(portalGoal('2026-04'), actor)).resolves.toMatchObject({
        program: { status: 'active' },
        version: {
          propertyTimezone: 'Europe/Sofia',
          effectiveFrom: new Date('2026-03-31T21:00:00.000Z'),
        },
      })
    })

    it('a quarantined source refuses creation with metric_unavailable', async () => {
      const { service, metrics, repository } = setup(MID_MARCH)
      vi.mocked(metrics.queryGoalMetric).mockResolvedValueOnce(
        readiness({ state: 'quarantined', reason: 'source_quarantined' }),
      )

      await expect(service.create(portalGoal('2026-03'), actor)).rejects.toMatchObject({
        code: 'metric_unavailable',
      } satisfies Partial<GoalProgramError>)
      expect(repository.create).not.toHaveBeenCalled()
    })

    it('a metric version that starts after the month began refuses the current month and allows the next', async () => {
      const { service, metrics, repository } = setup(MID_MARCH)
      const versionStart = new Date('2026-03-10T00:00:00.000Z')
      const ready = vi.mocked(metrics.queryGoalMetric).getMockImplementation()!
      vi.mocked(metrics.queryGoalMetric).mockImplementation(async (query) =>
        query.periodStart < versionStart
          ? readiness({ reason: 'metric_version_unavailable' })
          : ready(query),
      )

      await expect(service.create(portalGoal('2026-03'), actor)).rejects.toMatchObject({
        code: 'metric_unavailable',
      } satisfies Partial<GoalProgramError>)
      expect(repository.create).not.toHaveBeenCalled()

      await expect(service.create(portalGoal('2026-04'), actor)).resolves.toMatchObject({
        program: { status: 'scheduled' },
      })
    })

    // 04:30Z on 1 November 2026 is 00:30 in Havana, in the first pass of the
    // repeated midnight hour: local November, which begins at 05:00Z.
    it('keeps this month scheduled until its first instant in a repeated midnight hour', async () => {
      const { service, subjects, repository, setNow } = setup(
        new Date('2026-11-01T04:30:00.000Z'),
      )
      vi.mocked(subjects.getTimezone).mockResolvedValue('America/Havana')

      const bundle = await service.create(portalGoal('2026-11'), actor)

      expect(bundle.program).toMatchObject({
        status: 'scheduled',
        statusReason: 'awaiting_first_full_month',
      })
      expect(bundle.version.effectiveFrom).toEqual(new Date('2026-11-01T05:00:00.000Z'))
      expect(bundle.results).toEqual([])

      setNow(new Date('2026-11-01T05:00:00.000Z'))
      await expect(service.maintain()).resolves.toMatchObject({
        activated: 1,
        scheduledResults: 1,
      })
      expect(repository.activate).toHaveBeenCalledOnce()
    })

    it('refuses a Property with no time zone before reading anything else', async () => {
      const { service, subjects, metrics } = setup(MID_MARCH)
      vi.mocked(subjects.getTimezone).mockResolvedValue(null)

      await expect(service.create(portalGoal('2026-03'), actor)).rejects.toMatchObject({
        code: 'not_found',
      })
      expect(metrics.queryGoalMetric).not.toHaveBeenCalled()
    })
  })

  it('rejects duplicate subjects and policy-denied Member mutation', async () => {
    const { service, policy } = setup()
    await expect(
      service.create(
        {
          propertyId: PROPERTY_ID,
          name: 'Duplicates',
          metric: 'portal_rating_count',
          targetValue: 10,
          subjects: [
            { kind: 'portal', portalId: portalUuid(1) },
            { kind: 'portal', portalId: portalUuid(1) },
          ],
        },
        actor,
      ),
    ).rejects.toMatchObject({
      code: 'duplicate_subject',
    } satisfies Partial<GoalProgramError>)

    vi.mocked(policy.authorize).mockRejectedValueOnce(new GoalProgramError('forbidden'))
    await expect(
      service.create(
        {
          propertyId: PROPERTY_ID,
          name: 'Member cannot create',
          metric: 'portal_rating_count',
          targetValue: 10,
          subjects: [{ kind: 'property', propertyId: PROPERTY_ID }],
        },
        { ...actor, role: 'Member' },
      ),
    ).rejects.toMatchObject({ code: 'forbidden' } satisfies Partial<GoalProgramError>)
    expect(policy.authorize).toHaveBeenLastCalledWith({
      actor: { ...actor, role: 'Member' },
      organizationId: actor.organizationId,
      propertyId: PROPERTY_ID,
      action: 'goal.create',
    })
  })

  it('does not treat a raw role label as stronger than the execution policy', async () => {
    const { service } = setup()

    await expect(
      service.create(
        {
          propertyId: PROPERTY_ID,
          name: 'Policy-authorized program',
          metric: 'portal_rating_count',
          targetValue: 10,
          subjects: [{ kind: 'property', propertyId: PROPERTY_ID }],
        },
        { ...actor, role: 'Member' },
      ),
    ).resolves.toMatchObject({ program: { name: 'Policy-authorized program' } })
  })
})

describe('rating goals on switched Portals', () => {
  const request = {
    propertyId: PROPERTY_ID,
    name: 'A goal',
    description: null,
    metric: 'portal_rating_count' as const,
    targetValue: 10,
    subjects: [{ kind: 'portal' as const, portalId: portalUuid(1) }],
  }
  it.each(['portal_rating_count', 'portal_rating_average'] as const)(
    'refuses %s for a switched subject',
    async (metric) => {
      const { service, subjects, repository } = setup()
      vi.mocked(subjects.ratingSubjectsSkipPrivateRating!).mockResolvedValue(true)
      await expect(
        service.create(
          {
            ...request,
            metric,
            targetValue: metric === 'portal_rating_average' ? 4 : 10,
          },
          actor,
        ),
      ).rejects.toMatchObject({
        _tag: 'GoalProgramError',
        code: 'private_ratings_skipped',
        message: 'This subject skips private ratings. Choose scans instead.',
      })
      expect(repository.create).not.toHaveBeenCalled()
    },
  )
  it('refuses a change to ratings but keeps scans available', async () => {
    const { service, subjects } = setup()
    const scans = await service.create({ ...request, metric: 'qualified_scans' }, actor)
    vi.mocked(subjects.ratingSubjectsSkipPrivateRating!).mockResolvedValue(true)
    await expect(
      service.revise(
        {
          propertyId: PROPERTY_ID,
          programId: scans.program.id,
          metric: 'portal_rating_count',
          targetValue: 10,
          subjects: request.subjects,
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'private_ratings_skipped' })
  })
})

describe('rating-goal changes after its subjects skip ratings', () => {
  const input = {
    propertyId: PROPERTY_ID,
    name: 'Ratings',
    metric: 'portal_rating_count' as const,
    targetValue: 10,
    subjects: [{ kind: 'portal' as const, portalId: portalUuid(1) }],
  }
  it('refuses a running month target change', async () => {
    const { service, subjects } = setup()
    const goal = await service.create(input, actor)
    vi.mocked(subjects.ratingSubjectsSkipPrivateRating!).mockResolvedValue(true)
    await expect(
      service.changeMonthTarget(
        {
          propertyId: input.propertyId,
          programId: goal.program.id,
          month: '2026-03',
          targetValue: 12,
          expectedTarget: 10,
          expectedVersion: 1,
          expectedFollowingMonth: '2026-04',
          applyToFollowing: false,
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'private_ratings_skipped' })
  })
  it('refuses resumption but permits ending the goal', async () => {
    const { service, subjects } = setup()
    const goal = await service.create(input, actor)
    await service.changeStatus(
      { propertyId: input.propertyId, programId: goal.program.id, status: 'paused' },
      actor,
    )
    vi.mocked(subjects.ratingSubjectsSkipPrivateRating!).mockResolvedValue(true)
    await expect(
      service.changeStatus(
        { propertyId: input.propertyId, programId: goal.program.id, status: 'active' },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'private_ratings_skipped' })
    await expect(
      service.changeStatus(
        { propertyId: input.propertyId, programId: goal.program.id, status: 'ended' },
        actor,
      ),
    ).resolves.toMatchObject({ status: 'ended' })
  })
})
