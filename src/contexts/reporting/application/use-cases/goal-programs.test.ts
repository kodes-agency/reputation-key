import { beforeEach, describe, expect, it, vi } from 'vitest'
import { METRIC_VERSION_IDS } from '../../domain/metric-registry'
import type {
  GoalMonthlyResult,
  GoalProgramBundle,
  GoalProgramRepository,
  GoalResultRevision,
} from '../ports/goal-program.repository'
import {
  createGoalProgramService,
  GoalProgramError,
  MAX_GOAL_ASSIGNMENT_SELECTIONS,
  type GoalActor,
  type GoalExecutionPolicy,
  type GoalMetricReadPort,
  type GoalProgramSubjectReader,
} from './goal-programs'

const actor: GoalActor = {
  organizationId: 'org-1',
  userId: 'manager-1',
  role: 'PropertyManager',
}

const governedVersion = (id: string, minimumSample: number) => ({
  definition: {
    id: `definition-${id}`,
    key:
      id === METRIC_VERSION_IDS.portalRatingAverageGoal
        ? ('portal.rating_average' as const)
        : id === METRIC_VERSION_IDS.portalRatingCountGoal
          ? ('portal.rating_count' as const)
          : ('portal.qualified_scan' as const),
    name: 'Goal metric',
    description: 'Governed Goal metric',
    valueKind: 'counter' as const,
    workerDataFlag: false,
    privacyClass: 'content_free',
    retentionClass: 'aggregate',
    lifecycleStatus: 'approved' as const,
    approvalOwner: 'product',
  },
  version: {
    id,
    definitionId: `definition-${id}`,
    version: 1,
    effectiveFrom: new Date('2025-01-01T00:00:00.000Z'),
    effectiveTo: null,
    numeratorDescription: 'events',
    denominatorDescription: null,
    unit: 'count',
    precision: 1,
    aggregationRule: 'sum',
    lateArrivalRule: '24h',
    allowedScopes: ['property', 'portal_group', 'portal'] as const,
    attributionRule: 'event time',
    minimumSample,
    insufficientDataBehavior: 'unavailable' as const,
    sourcePolicyAllowlist: ['first_party_guest_gateway_metric'] as const,
    permittedConsumers: ['goal'] as const,
    employmentDecisionEligible: false as const,
    correctionBehavior: 'append',
    fairnessReviewStatus: 'approved',
  },
})

function setup(initialNow = new Date('2026-03-01T00:00:00.000Z')) {
  let id = 0
  let now = initialNow
  let organizationHeld = false
  let created: GoalProgramBundle | null = null
  const results = new Map<string, GoalMonthlyResult>()
  const resultRevisions = new Map<string, GoalResultRevision>()
  const assignmentHistory = new Map<string, GoalProgramBundle['assignments'][number]>()
  const versionHistory = new Map<string, GoalProgramBundle['version']>()
  const repository: GoalProgramRepository = {
    create: vi.fn(async ({ bundle }) => {
      created = bundle
      for (const result of bundle.results) results.set(result.id, result)
      for (const assignment of bundle.assignments) {
        assignmentHistory.set(assignment.id, assignment)
      }
      versionHistory.set(bundle.version.id, bundle.version)
      return 'created' as const
    }),
    get: vi.fn(async () => created),
    list: vi.fn(async () => (created ? [created] : [])),
    listOperational: vi.fn(async () =>
      created && ['scheduled', 'active'].includes(created.program.status)
        ? [created]
        : [],
    ),
    isOrganizationHeld: vi.fn(async () => organizationHeld),
    changeStatus: vi.fn(async (input) => {
      if (!created || created.program.status !== input.expectedStatus) return null
      const program = {
        ...created.program,
        status: input.status,
        statusReason: input.reason,
        updatedAt: input.at,
      }
      created = { ...created, program }
      return program
    }),
    revise: vi.fn(
      async ({
        expectedVersion,
        version,
        assignments,
        supersedeRowlessHead,
        scheduledStatusReason,
        at,
      }) => {
        if (!created) return false
        const previous = created
        const headHasMonths = previous.results.some(
          (result) => result.programVersionId === expectedVersion.id,
        )
        if (supersedeRowlessHead && headHasMonths) return false
        // The port's contract: a replaced head keeps the empty window
        // [from, from); a head in force closes where the new version starts.
        const closedAt = (window: Readonly<{ effectiveFrom: Date }>) =>
          supersedeRowlessHead ? window.effectiveFrom : version.effectiveFrom
        created = {
          program: {
            ...previous.program,
            currentVersion: version.version,
            // The port's contract: only a Program still scheduled takes it.
            statusReason:
              scheduledStatusReason !== undefined &&
              previous.program.status === 'scheduled'
                ? scheduledStatusReason
                : previous.program.statusReason,
            updatedAt: at,
          },
          version,
          versions: [
            ...previous.versions.map((known) =>
              known.id === expectedVersion.id
                ? { ...known, effectiveTo: closedAt(known) }
                : known,
            ),
            version,
          ],
          assignments: [
            ...previous.assignments.map((known) =>
              known.programVersionId === expectedVersion.id
                ? { ...known, effectiveTo: closedAt(known) }
                : known,
            ),
            ...assignments,
          ],
          results: previous.results,
        }
        for (const assignment of created.assignments) {
          assignmentHistory.set(assignment.id, assignment)
        }
        for (const known of created.versions) versionHistory.set(known.id, known)
        return true
      },
    ),
    rename: vi.fn(async (input) => {
      if (!created || created.program.status === 'ended') return null
      // The port's contract: only while the goal still says what was read.
      if (
        created.program.name !== input.previousName ||
        created.program.description !== input.previousDescription
      ) {
        return null
      }
      const program = {
        ...created.program,
        name: input.name,
        description: input.description,
        updatedAt: input.at,
      }
      created = { ...created, program }
      return program
    }),
    findAssignmentConflicts: vi.fn(async () => []),
    // Its cases have a suite and a stand-in of their own (goal-month-target.test.ts).
    changeMonthTarget: vi.fn(async () => 'changed' as const),
    activate: vi.fn(async ({ bundle, results: newResults, at }) => {
      const program = {
        ...bundle.program,
        status: 'active' as const,
        statusReason: null,
        updatedAt: at,
      }
      created = {
        ...bundle,
        program,
        results: [...bundle.results, ...newResults],
      }
      for (const result of newResults) results.set(result.id, result)
      return program
    }),
    appendResults: vi.fn(async ({ results: newResults }) => {
      for (const result of newResults) results.set(result.id, result)
      if (created) created = { ...created, results: [...created.results, ...newResults] }
      return newResults.length
    }),
    listDueResults: vi.fn(async (at) =>
      [...results.values()].filter(
        (result) =>
          result.periodEnd <= at &&
          (result.status === 'open' || result.status === 'reconciling'),
      ),
    ),
    getDueResult: vi.fn(async (organizationId, propertyId, resultId, at) => {
      const result = results.get(resultId)
      if (
        !result ||
        result.organizationId !== organizationId ||
        result.propertyId !== propertyId ||
        result.periodEnd > at ||
        (result.status !== 'open' && result.status !== 'reconciling')
      ) {
        return null
      }
      return result
    }),
    getAssignment: vi.fn(
      async (_org, _property, assignmentId) =>
        assignmentHistory.get(assignmentId) ?? null,
    ),
    getVersion: vi.fn(
      async (_org, _property, versionId) => versionHistory.get(versionId) ?? null,
    ),
    updateResult: vi.fn(async ({ result, expectedStatus }) => {
      const current = results.get(result.id)
      if (!current || current.status !== expectedStatus) return null
      results.set(result.id, result)
      return result
    }),
    getClosedResult: vi.fn(async (organizationId, propertyId, resultId) => {
      const result = results.get(resultId)
      if (
        !result ||
        result.status !== 'closed' ||
        result.organizationId !== organizationId ||
        result.propertyId !== propertyId
      ) {
        return null
      }
      const revision = resultRevisions.get(resultId) ?? null
      return {
        result: revision
          ? {
              ...result,
              evaluation: revision.evaluation,
              sourceCompleteThrough: revision.sourceCompleteThrough,
              evaluationWatermark: revision.evaluationWatermark,
              updatedAt: revision.createdAt,
            }
          : result,
        revision,
      }
    }),
    appendResultRevision: vi.fn(async (input) => {
      const current = resultRevisions.get(input.head.result.id) ?? null
      if ((current?.id ?? null) !== (input.head.revision?.id ?? null)) {
        return { status: 'conflict' as const }
      }
      const same =
        JSON.stringify(input.head.result.evaluation) ===
          JSON.stringify(input.evaluation) &&
        input.head.result.sourceCompleteThrough?.getTime() ===
          input.sourceCompleteThrough?.getTime()
      if (same) return { status: 'unchanged' as const, result: input.head.result }
      const revision: GoalResultRevision = {
        id: input.revisionId,
        monthlyResultId: input.head.result.id,
        organizationId: input.head.result.organizationId,
        propertyId: input.head.result.propertyId,
        revision: (current?.revision ?? 0) + 1,
        supersedesRevisionId: current?.id ?? null,
        evaluation: input.evaluation,
        sourceCompleteThrough: input.sourceCompleteThrough,
        evaluationWatermark: input.evaluationWatermark,
        changeReason: input.changeReason,
        createdBy: input.createdBy,
        createdAt: input.at,
      }
      resultRevisions.set(input.head.result.id, revision)
      return {
        status: 'revised' as const,
        result: {
          ...input.head.result,
          evaluation: revision.evaluation,
          sourceCompleteThrough: revision.sourceCompleteThrough,
          evaluationWatermark: revision.evaluationWatermark,
          updatedAt: revision.createdAt,
        },
        revision,
        outcomeChanged:
          input.head.result.evaluation.achieved !== input.evaluation.achieved,
        availabilityChanged:
          input.head.result.evaluation.state !== input.evaluation.state,
      }
    }),
    findClosedResultIdsForMetricImpact: vi.fn(async () => []),
  }
  const metrics: GoalMetricReadPort = {
    queryGoalMetric: vi.fn<GoalMetricReadPort['queryGoalMetric']>(async (query) => ({
      definitionVersionId: query.definitionVersionId,
      metricKey:
        query.definitionVersionId === METRIC_VERSION_IDS.qualifiedScanGoal
          ? 'portal.qualified_scan'
          : 'portal.rating_count',
      state: 'updating' as const,
      exactValue: 0,
      sampleCount: 0,
      minimumSample: 0,
      sourceCompleteThrough: null,
      reason: 'source_reconciling',
    })),
    getApprovedGoalVersion: vi.fn(async (versionId) =>
      governedVersion(
        versionId,
        versionId === METRIC_VERSION_IDS.portalRatingAverageGoal ? 10 : 0,
      ),
    ),
  }
  const policy: GoalExecutionPolicy = { authorize: vi.fn(async () => undefined) }
  const subjects: GoalProgramSubjectReader = {
    getTimezone: vi.fn(async () => 'UTC'),
    subjectBelongsToProperty: vi.fn<GoalProgramSubjectReader['subjectBelongsToProperty']>(
      async () => true,
    ),
    listCurrentPortalIds: vi.fn<GoalProgramSubjectReader['listCurrentPortalIds']>(
      async () => ['portal-2', 'portal-3'],
    ),
  }
  const service = createGoalProgramService({
    repository,
    policy,
    subjects,
    metrics,
    id: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    now: () => now,
  })
  return {
    service,
    policy,
    repository,
    metrics,
    subjects,
    results,
    getCreated: () => created,
    setNow: (next: Date) => {
      now = next
    },
    /** The Organization's lifecycle holds it (a closure requested or in progress). */
    holdOrganization: () => {
      organizationHeld = true
    },
  }
}

describe('canonical Goal Program service', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('atomically creates one pinned program with many subjects and monthly results', async () => {
    const { service, repository } = setup()
    const bundle = await service.create(
      {
        propertyId: 'property-1',
        name: '  March ratings  ',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: [
          { kind: 'property', propertyId: 'property-1' },
          { kind: 'portal_group', portalGroupId: 'group-1' },
          { kind: 'portal', portalId: 'portal-1' },
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

  it('keeps a configurable metric scheduled when its source producer is inactive', async () => {
    const { service, metrics } = setup()
    vi.mocked(metrics.queryGoalMetric).mockResolvedValueOnce({
      definitionVersionId: METRIC_VERSION_IDS.qualifiedScanGoal,
      metricKey: 'portal.qualified_scan',
      state: 'unavailable',
      exactValue: null,
      sampleCount: 0,
      minimumSample: 0,
      sourceCompleteThrough: null,
      reason: 'metric_source_not_active',
    })
    const bundle = await service.create(
      {
        propertyId: 'property-1',
        name: 'Qualified scans',
        metric: 'qualified_scans',
        targetValue: 100,
        subjects: [{ kind: 'portal', portalId: 'portal-1' }],
      },
      actor,
    )
    expect(bundle.program).toMatchObject({
      status: 'scheduled',
      statusReason: 'metric_source_not_active',
    })
    expect(bundle.assignments).toHaveLength(1)
    expect(bundle.results).toEqual([])
  })

  describe('start month', () => {
    const MARCH = {
      start: new Date('2026-03-01T00:00:00.000Z'),
      end: new Date('2026-04-01T00:00:00.000Z'),
    }
    const MID_MARCH = new Date('2026-03-15T12:00:00.000Z')
    const portalGoal = (startMonth?: string) =>
      ({
        propertyId: 'property-1',
        name: 'Ratings',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: [{ kind: 'portal', portalId: 'portal-1' }],
        ...(startMonth === undefined ? {} : { startMonth }),
      }) as const
    const readinessOf = (
      patch: Partial<Awaited<ReturnType<GoalMetricReadPort['queryGoalMetric']>>>,
    ) => ({
      definitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
      metricKey: 'portal.rating_count' as const,
      state: 'unavailable' as const,
      exactValue: null,
      sampleCount: 0,
      minimumSample: 0,
      sourceCompleteThrough: null,
      reason: null,
      ...patch,
    })

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

    it('the current month with an inactive source is scheduled and opens March on activation', async () => {
      const { service, metrics, repository, getCreated } = setup(MID_MARCH)
      vi.mocked(metrics.queryGoalMetric).mockResolvedValueOnce(
        readinessOf({ reason: 'metric_source_not_active' }),
      )

      const bundle = await service.create(portalGoal('2026-03'), actor)

      expect(bundle.program).toMatchObject({
        status: 'scheduled',
        statusReason: 'metric_source_not_active',
      })
      expect(bundle.version.effectiveFrom).toEqual(MARCH.start)
      expect(bundle.results).toEqual([])

      // The source is active on the next hourly run: the goal activates and
      // March opens from its first day, not from the day of activation.
      await expect(service.maintain()).resolves.toMatchObject({
        activated: 1,
        scheduledResults: 1,
        failed: 0,
      })
      expect(repository.activate).toHaveBeenCalledWith(
        expect.objectContaining({
          results: [
            expect.objectContaining({
              periodStart: MARCH.start,
              periodEnd: MARCH.end,
              status: 'open',
            }),
          ],
        }),
      )
      expect(getCreated()?.program.status).toBe('active')
    })

    it('create refuses a subject that already has a live goal for the metric', async () => {
      const { service, repository } = setup(MID_MARCH)
      vi.mocked(repository.findAssignmentConflicts).mockResolvedValueOnce([
        {
          subject: { kind: 'portal', portalId: 'portal-1' },
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
        propertyId: 'property-1',
        metric: 'portal_rating_count',
        effectiveFrom: MARCH.start,
        subjects: [{ kind: 'portal', portalId: 'portal-1' }],
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
        readinessOf({ state: 'quarantined', reason: 'source_quarantined' }),
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
          ? readinessOf({ reason: 'metric_version_unavailable' })
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
          propertyId: 'property-1',
          name: 'Duplicates',
          metric: 'portal_rating_count',
          targetValue: 10,
          subjects: [
            { kind: 'portal', portalId: 'portal-1' },
            { kind: 'portal', portalId: 'portal-1' },
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
          propertyId: 'property-1',
          name: 'Member cannot create',
          metric: 'portal_rating_count',
          targetValue: 10,
          subjects: [{ kind: 'property', propertyId: 'property-1' }],
        },
        { ...actor, role: 'Member' },
      ),
    ).rejects.toMatchObject({ code: 'forbidden' } satisfies Partial<GoalProgramError>)
    expect(policy.authorize).toHaveBeenLastCalledWith({
      actor: { ...actor, role: 'Member' },
      organizationId: actor.organizationId,
      propertyId: 'property-1',
      action: 'goal.create',
    })
  })

  it('does not treat a raw role label as stronger than the execution policy', async () => {
    const { service } = setup()

    await expect(
      service.create(
        {
          propertyId: 'property-1',
          name: 'Policy-authorized program',
          metric: 'portal_rating_count',
          targetValue: 10,
          subjects: [{ kind: 'property', propertyId: 'property-1' }],
        },
        { ...actor, role: 'Member' },
      ),
    ).resolves.toMatchObject({ program: { name: 'Policy-authorized program' } })
  })

  it('applies revisions only from the next complete property-local month', async () => {
    const { service, repository } = setup()
    const created = await service.create(
      {
        propertyId: 'property-1',
        name: 'Monthly ratings',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: [{ kind: 'portal', portalId: 'portal-1' }],
      },
      actor,
    )
    const revised = await service.revise(
      {
        propertyId: 'property-1',
        programId: created.program.id,
        metric: 'portal_rating_average',
        targetValue: 4.5,
        subjects: [
          { kind: 'portal', portalId: 'portal-1' },
          { kind: 'portal', portalId: 'portal-2' },
        ],
        reason: 'Use the agreed average target',
      },
      actor,
    )
    expect(revised.version).toMatchObject({
      version: 2,
      metric: 'portal_rating_average',
      metricMinimumSample: 10,
      effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
    })
    expect(revised.assignments).toHaveLength(3)
    expect(
      revised.assignments.filter(
        (assignment) => assignment.programVersionId === revised.version.id,
      ),
    ).toHaveLength(2)
    expect(revised.results).toHaveLength(1)
    expect(repository.revise).toHaveBeenCalledOnce()
  })

  // The open month belongs to the version's own timezone. A Property that
  // moved east starts its next local month BEFORE that month ends (Sofia's
  // April begins 2026-03-31T21:00Z, inside UTC March), and closing the old
  // version there would leave March outside its version window for good.
  it('starts a revision after the open month when the Property timezone moved east', async () => {
    const { service, repository, subjects, setNow } = setup()
    const created = await service.create(
      {
        propertyId: 'property-1',
        name: 'Monthly ratings',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: [{ kind: 'portal', portalId: 'portal-1' }],
      },
      actor,
    )
    setNow(new Date('2026-03-20T12:00:00.000Z'))
    vi.mocked(subjects.getTimezone).mockResolvedValue('Europe/Sofia')

    const revised = await service.revise(
      {
        propertyId: 'property-1',
        programId: created.program.id,
        metric: 'portal_rating_count',
        targetValue: 40,
        subjects: [{ kind: 'portal', portalId: 'portal-1' }],
        reason: 'The property moved to Sofia time',
      },
      actor,
    )

    // March (UTC) ends 2026-04-01T00:00Z; the first Sofia month that starts
    // at or after it is May.
    expect(revised.version).toMatchObject({
      propertyTimezone: 'Europe/Sofia',
      effectiveFrom: new Date('2026-04-30T21:00:00.000Z'),
    })
    expect(repository.revise).toHaveBeenCalledWith(
      expect.objectContaining({
        version: expect.objectContaining({
          effectiveFrom: new Date('2026-04-30T21:00:00.000Z'),
        }),
      }),
    )
  })

  it('keeps the next local month when the Property timezone moved west', async () => {
    const { service, subjects, setNow } = setup(new Date('2026-02-28T22:00:00.000Z'))
    vi.mocked(subjects.getTimezone).mockResolvedValue('Europe/Sofia')
    const created = await service.create(
      {
        propertyId: 'property-1',
        name: 'Monthly ratings',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: [{ kind: 'portal', portalId: 'portal-1' }],
      },
      actor,
    )
    expect(created.results[0]?.periodEnd).toEqual(new Date('2026-03-31T21:00:00.000Z'))
    setNow(new Date('2026-03-20T12:00:00.000Z'))
    vi.mocked(subjects.getTimezone).mockResolvedValue('UTC')

    const revised = await service.revise(
      {
        propertyId: 'property-1',
        programId: created.program.id,
        metric: 'portal_rating_count',
        targetValue: 40,
        subjects: [{ kind: 'portal', portalId: 'portal-1' }],
        reason: 'The property moved to UTC',
      },
      actor,
    )

    expect(revised.version).toMatchObject({
      propertyTimezone: 'UTC',
      effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
    })
  })

  it('bulk-adds and removes explicit subjects in one fenced next-month revision', async () => {
    const { service, repository, setNow } = setup()
    const created = await service.create(
      {
        propertyId: 'property-1',
        name: 'Monthly ratings',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: [
          { kind: 'property', propertyId: 'property-1' },
          { kind: 'portal', portalId: 'portal-1' },
        ],
      },
      actor,
    )
    setNow(new Date('2026-03-15T12:00:00.000Z'))

    const changed = await service.changeAssignments(
      {
        propertyId: 'property-1',
        programId: created.program.id,
        expectedVersion: 1,
        add: [{ kind: 'portal_group', portalGroupId: 'group-1' }],
        remove: [{ kind: 'portal', portalId: 'portal-1' }],
        selectAllCurrentPortals: false,
        reason: 'Apply the new operating scope',
      },
      actor,
    )

    expect(changed).toMatchObject({
      previousVersion: 1,
      currentVersion: 2,
      effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
      outcomes: [
        {
          operation: 'add',
          subject: { kind: 'portal_group', portalGroupId: 'group-1' },
          outcome: 'added',
        },
        {
          operation: 'remove',
          subject: { kind: 'portal', portalId: 'portal-1' },
          outcome: 'removed',
        },
      ],
    })
    const revision = vi.mocked(repository.revise).mock.calls.at(-1)?.[0]
    expect(revision?.expectedVersion.version).toBe(1)
    expect(revision?.version).toMatchObject({
      version: 2,
      metric: 'portal_rating_count',
      targetValue: 25,
      effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
    })
    expect(revision?.assignments.map(({ subject }) => subject)).toEqual([
      { kind: 'property', propertyId: 'property-1' },
      { kind: 'portal_group', portalGroupId: 'group-1' },
    ])
  })

  it('expands all current Portals once at request time without future inheritance', async () => {
    const { service, subjects, repository, setNow } = setup()
    const created = await service.create(
      {
        propertyId: 'property-1',
        name: 'Portal scans',
        metric: 'qualified_scans',
        targetValue: 100,
        subjects: [{ kind: 'portal', portalId: 'portal-1' }],
      },
      actor,
    )
    setNow(new Date('2026-03-15T12:00:00.000Z'))

    const changed = await service.changeAssignments(
      {
        propertyId: 'property-1',
        programId: created.program.id,
        expectedVersion: 1,
        add: [],
        remove: [],
        selectAllCurrentPortals: true,
        reason: 'Cover every portal operating today',
      },
      actor,
    )

    expect(subjects.listCurrentPortalIds).toHaveBeenCalledWith(
      actor.organizationId,
      'property-1',
      MAX_GOAL_ASSIGNMENT_SELECTIONS + 1,
    )
    expect(changed.selectedAt).toEqual(new Date('2026-03-15T12:00:00.000Z'))
    expect(changed.selectedCurrentPortalCount).toBe(2)
    expect(changed.outcomes).toEqual([
      {
        operation: 'add',
        source: 'all_current_portals',
        subject: { kind: 'portal', portalId: 'portal-2' },
        outcome: 'added',
      },
      {
        operation: 'add',
        source: 'all_current_portals',
        subject: { kind: 'portal', portalId: 'portal-3' },
        outcome: 'added',
      },
    ])
    expect(
      vi
        .mocked(repository.revise)
        .mock.calls.at(-1)?.[0]
        .assignments.map(({ subject }) => subject),
    ).toEqual([
      { kind: 'portal', portalId: 'portal-1' },
      { kind: 'portal', portalId: 'portal-2' },
      { kind: 'portal', portalId: 'portal-3' },
    ])

    vi.mocked(subjects.listCurrentPortalIds).mockResolvedValueOnce([
      'portal-2',
      'portal-3',
      'portal-created-later',
    ])
    expect(vi.mocked(repository.revise)).toHaveBeenCalledOnce()
  })

  it('reports duplicate, conflicting, invalid, overlapping, and no-op selections', async () => {
    const { service, subjects, repository, setNow } = setup()
    const created = await service.create(
      {
        propertyId: 'property-1',
        name: 'Portal scans',
        metric: 'qualified_scans',
        targetValue: 100,
        subjects: [
          { kind: 'property', propertyId: 'property-1' },
          { kind: 'portal', portalId: 'portal-1' },
        ],
      },
      actor,
    )
    setNow(new Date('2026-03-15T12:00:00.000Z'))
    vi.mocked(subjects.subjectBelongsToProperty).mockImplementation(
      async (_org, _property, subject) =>
        subject.kind !== 'portal' || subject.portalId !== 'foreign-portal',
    )
    vi.mocked(repository.findAssignmentConflicts).mockResolvedValueOnce([
      {
        subject: { kind: 'portal', portalId: 'busy-portal' },
        programId: 'program-busy',
        effectiveTo: null,
      },
    ])

    const changed = await service.changeAssignments(
      {
        propertyId: 'property-1',
        programId: created.program.id,
        expectedVersion: 1,
        add: [
          { kind: 'portal', portalId: 'portal-1' },
          { kind: 'portal', portalId: 'portal-2' },
          { kind: 'portal', portalId: 'portal-2' },
          { kind: 'portal', portalId: 'foreign-portal' },
          { kind: 'portal', portalId: 'busy-portal' },
          { kind: 'portal_group', portalGroupId: 'both-ways' },
        ],
        remove: [
          { kind: 'portal', portalId: 'not-assigned' },
          { kind: 'portal_group', portalGroupId: 'both-ways' },
        ],
        selectAllCurrentPortals: false,
        reason: 'Apply valid selections only',
      },
      actor,
    )

    expect(changed.outcomes.map(({ outcome }) => outcome)).toEqual([
      'already_assigned',
      'added',
      'duplicate',
      'invalid_subject',
      'overlap',
      'conflicting_operations',
      'not_assigned',
      'conflicting_operations',
    ])
    expect(
      vi
        .mocked(repository.revise)
        .mock.calls.at(-1)?.[0]
        .assignments.map(({ subject }) => subject),
    ).toEqual([
      { kind: 'property', propertyId: 'property-1' },
      { kind: 'portal', portalId: 'portal-1' },
      { kind: 'portal', portalId: 'portal-2' },
    ])
  })

  it('fences stale and oversized assignment changes before persistence', async () => {
    const { service, repository, subjects, setNow } = setup()
    const created = await service.create(
      {
        propertyId: 'property-1',
        name: 'Portal scans',
        metric: 'qualified_scans',
        targetValue: 100,
        subjects: [{ kind: 'portal', portalId: 'portal-1' }],
      },
      actor,
    )
    setNow(new Date('2026-03-15T12:00:00.000Z'))

    await expect(
      service.changeAssignments(
        {
          propertyId: 'property-1',
          programId: created.program.id,
          expectedVersion: 2,
          add: [{ kind: 'portal', portalId: 'portal-2' }],
          remove: [],
          selectAllCurrentPortals: false,
          reason: 'Stale browser state',
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'revision_conflict' })

    vi.mocked(subjects.listCurrentPortalIds).mockResolvedValueOnce(
      Array.from(
        { length: MAX_GOAL_ASSIGNMENT_SELECTIONS + 1 },
        (_, index) => `portal-${index + 10}`,
      ),
    )
    await expect(
      service.changeAssignments(
        {
          propertyId: 'property-1',
          programId: created.program.id,
          expectedVersion: 1,
          add: [],
          remove: [],
          selectAllCurrentPortals: true,
          reason: 'Too many current portals',
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'assignment_limit_exceeded' })
    expect(repository.revise).not.toHaveBeenCalled()
  })

  it('authorizes assignment changes before validation or repository reads', async () => {
    const { service, policy, repository } = setup()
    const created = await service.create(
      {
        propertyId: 'property-1',
        name: 'Portal scans',
        metric: 'qualified_scans',
        targetValue: 100,
        subjects: [{ kind: 'portal', portalId: 'portal-1' }],
      },
      actor,
    )
    vi.mocked(repository.get).mockClear()
    vi.mocked(policy.authorize).mockRejectedValueOnce(new GoalProgramError('forbidden'))

    await expect(
      service.changeAssignments(
        {
          propertyId: 'property-1',
          programId: created.program.id,
          expectedVersion: 1,
          add: Array.from({ length: MAX_GOAL_ASSIGNMENT_SELECTIONS + 1 }, (_, index) => ({
            kind: 'portal' as const,
            portalId: `portal-${index}`,
          })),
          remove: [],
          selectAllCurrentPortals: false,
          reason: '',
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(repository.get).not.toHaveBeenCalled()
  })

  it('bounds the resulting assignment set', async () => {
    const { service, repository, setNow } = setup()
    const currentSubjects = Array.from(
      { length: MAX_GOAL_ASSIGNMENT_SELECTIONS },
      (_, index) => ({ kind: 'portal' as const, portalId: `portal-${index}` }),
    )
    const created = await service.create(
      {
        propertyId: 'property-1',
        name: 'Portal scans',
        metric: 'qualified_scans',
        targetValue: 100,
        subjects: currentSubjects,
      },
      actor,
    )
    setNow(new Date('2026-03-15T12:00:00.000Z'))

    await expect(
      service.changeAssignments(
        {
          propertyId: 'property-1',
          programId: created.program.id,
          expectedVersion: 1,
          add: [{ kind: 'portal', portalId: 'portal-over-limit' }],
          remove: [],
          selectAllCurrentPortals: false,
          reason: 'One subject too many',
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'assignment_limit_exceeded' })
    await expect(
      service.changeAssignments(
        {
          propertyId: 'property-1',
          programId: created.program.id,
          expectedVersion: 1,
          add: [],
          remove: [],
          selectAllCurrentPortals: false,
          reason: 'No selections',
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'invalid_subject' })
    expect(repository.revise).not.toHaveBeenCalled()
  })

  describe('changing a goal', () => {
    const MARCH = new Date('2026-03-01T00:00:00.000Z')
    const APRIL = new Date('2026-04-01T00:00:00.000Z')
    const MAY = new Date('2026-05-01T00:00:00.000Z')
    const MID_MARCH = new Date('2026-03-15T12:00:00.000Z')
    const portal = (id: number) => ({ kind: 'portal' as const, portalId: `portal-${id}` })

    /** The next read of a measure finds its source not active yet. */
    const sourceNotActiveOnce = (metrics: GoalMetricReadPort) =>
      vi.mocked(metrics.queryGoalMetric).mockResolvedValueOnce({
        definitionVersionId: METRIC_VERSION_IDS.qualifiedScanGoal,
        metricKey: 'portal.qualified_scan',
        state: 'unavailable',
        exactValue: null,
        sampleCount: 0,
        minimumSample: 0,
        sourceCompleteThrough: null,
        reason: 'metric_source_not_active',
      })

    /**
     * A scans goal for portal-1. Created on 1 March it is active with March
     * open; mid-March it waits for April. Planned on a `not_active` source it
     * is scheduled whenever it is created, and waits for that source.
     */
    async function scansGoal(at?: Date, source: 'active' | 'not_active' = 'active') {
      const context = setup(at)
      if (source === 'not_active') sourceNotActiveOnce(context.metrics)
      const created = await context.service.create(
        {
          propertyId: 'property-1',
          name: 'Portal scans',
          metric: 'qualified_scans',
          targetValue: 100,
          subjects: [portal(1)],
        },
        actor,
      )
      const revise = (
        patch: Partial<Parameters<typeof context.service.revise>[0]> = {},
      ) =>
        context.service.revise(
          {
            propertyId: 'property-1',
            programId: created.program.id,
            metric: 'qualified_scans',
            targetValue: 120,
            subjects: [portal(1)],
            ...patch,
          },
          actor,
        )
      const addPortal = (
        id: number,
        expectedVersion: number,
        reason?: string,
      ): ReturnType<typeof context.service.changeAssignments> =>
        context.service.changeAssignments(
          {
            propertyId: 'property-1',
            programId: created.program.id,
            expectedVersion,
            add: [portal(id)],
            remove: [],
            selectAllCurrentPortals: false,
            reason,
          },
          actor,
        )
      const revisions = () => vi.mocked(context.repository.revise).mock.calls
      return { ...context, created, revise, addPortal, revisions }
    }

    it('revising a goal that has not started replaces the pending version and keeps its start month', async () => {
      const { created, revise, repository } = await scansGoal(MID_MARCH)
      expect(created).toMatchObject({
        program: { status: 'scheduled' },
        version: { effectiveFrom: APRIL },
        results: [],
      })

      const revised = await revise()

      expect(revised.program).toMatchObject({ status: 'scheduled', currentVersion: 2 })
      expect(revised.version).toMatchObject({
        version: 2,
        targetValue: 120,
        effectiveFrom: APRIL,
        effectiveTo: null,
      })
      expect(repository.revise).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedVersion: expect.objectContaining({ id: created.version.id }),
          supersedeRowlessHead: true,
        }),
      )
      // The replaced plan keeps an empty window: it never held the subject.
      expect(revised.versions[0]).toMatchObject({
        id: created.version.id,
        effectiveFrom: APRIL,
        effectiveTo: APRIL,
      })
      expect(revised.assignments).toMatchObject([
        { programVersionId: created.version.id, effectiveTo: APRIL },
        { programVersionId: revised.version.id, effectiveFrom: APRIL, effectiveTo: null },
      ])
    })

    it('a second pending change supersedes the first', async () => {
      const { created, revise, addPortal, revisions, setNow } = await scansGoal()
      setNow(MID_MARCH)

      await expect(addPortal(2, 1)).resolves.toMatchObject({
        currentVersion: 2,
        effectiveFrom: APRIL,
      })
      await expect(addPortal(3, 2)).resolves.toMatchObject({
        previousVersion: 2,
        currentVersion: 3,
        effectiveFrom: APRIL,
      })
      const revised = await revise({ subjects: [portal(1), portal(2), portal(3)] })

      // The version in force is closed where the change starts. Each change
      // after it replaces a plan that has no month yet.
      expect(
        revisions().map(([input]) => [
          input.expectedVersion.version,
          input.supersedeRowlessHead,
        ]),
      ).toEqual([
        [1, false],
        [2, true],
        [3, true],
      ])
      // The second change builds on the first pending plan, not on March's.
      expect(revisions()[1]?.[0].assignments.map(({ subject }) => subject)).toEqual([
        portal(1),
        portal(2),
        portal(3),
      ])
      expect(
        revised.versions.map((known) => [
          known.version,
          known.effectiveFrom,
          known.effectiveTo,
        ]),
      ).toEqual([
        [1, MARCH, APRIL],
        [2, APRIL, APRIL],
        [3, APRIL, APRIL],
        [4, APRIL, null],
      ])
      // March stays with the version it opened under.
      expect(revised.results).toMatchObject([
        { programVersionId: created.version.id, periodStart: MARCH },
      ])
    })

    it('a scheduled goal whose start has passed is still edited as never started', async () => {
      const { service, repository, revise, setNow } = await scansGoal(MID_MARCH)
      // April has begun and the hourly job has not activated the goal yet.
      setNow(new Date('2026-04-01T00:30:00.000Z'))

      const revised = await revise()

      expect(revised.version).toMatchObject({ version: 2, effectiveFrom: APRIL })
      expect(repository.revise).toHaveBeenCalledWith(
        expect.objectContaining({ supersedeRowlessHead: true }),
      )
      expect(repository.appendResults).not.toHaveBeenCalled()

      // The next pass activates the new head and opens April under it.
      await expect(service.maintain()).resolves.toMatchObject({
        activated: 1,
        scheduledResults: 1,
        failed: 0,
      })
      expect(repository.activate).toHaveBeenCalledWith(
        expect.objectContaining({
          results: [
            expect.objectContaining({
              programVersionId: revised.version.id,
              periodStart: APRIL,
              periodEnd: MAY,
            }),
          ],
        }),
      )
    })

    // The reason says what a scheduled goal waits for, and the page prints
    // it. An edit before the start can change the measure, so it is decided
    // again from the measure the goal now has, as it was at creation.
    it('an edit before the start onto a ready measure says the goal waits for its month', async () => {
      const { created, revise, revisions, getCreated } = await scansGoal(
        MID_MARCH,
        'not_active',
      )
      expect(created.program).toMatchObject({
        status: 'scheduled',
        statusReason: 'metric_source_not_active',
      })

      const revised = await revise({ metric: 'portal_rating_count', targetValue: 25 })

      expect(revised.program).toMatchObject({
        status: 'scheduled',
        statusReason: 'awaiting_first_full_month',
      })
      expect(revisions()[0]?.[0].scheduledStatusReason).toBe('awaiting_first_full_month')
      expect(getCreated()?.program.statusReason).toBe('awaiting_first_full_month')
    })

    it('an edit before the start onto a measure that is not ready says the goal waits for its source', async () => {
      const { created, metrics, revise, revisions, getCreated } =
        await scansGoal(MID_MARCH)
      expect(created.program.statusReason).toBe('awaiting_first_full_month')
      sourceNotActiveOnce(metrics)

      const revised = await revise()

      expect(revised.program).toMatchObject({
        status: 'scheduled',
        statusReason: 'metric_source_not_active',
      })
      expect(revisions()[0]?.[0].scheduledStatusReason).toBe('metric_source_not_active')
      expect(getCreated()?.program.statusReason).toBe('metric_source_not_active')
    })

    it('revising a goal that has started leaves its status reason alone', async () => {
      const { service, created, revise, revisions, setNow } = await scansGoal()
      setNow(MID_MARCH)
      await service.changeStatus(
        {
          propertyId: 'property-1',
          programId: created.program.id,
          status: 'paused',
          reason: 'Closed for works',
        },
        actor,
      )

      const revised = await revise()

      expect(revised.program).toMatchObject({
        status: 'paused',
        statusReason: 'Closed for works',
      })
      expect(revisions()[0]?.[0].scheduledStatusReason).toBeUndefined()
    })

    it('revise right after a month begins opens that month first and starts the revision next month', async () => {
      const { created, repository, revise, setNow } = await scansGoal()
      // April has begun and the hourly job has not opened it yet.
      setNow(new Date('2026-04-01T00:10:00.000Z'))

      const revised = await revise()

      expect(repository.appendResults).toHaveBeenCalledOnce()
      expect(repository.appendResults).toHaveBeenCalledWith(
        expect.objectContaining({
          version: expect.objectContaining({ id: created.version.id }),
          results: [
            expect.objectContaining({
              programVersionId: created.version.id,
              periodStart: APRIL,
              periodEnd: MAY,
            }),
          ],
        }),
      )
      expect(revised.results.map(({ periodStart }) => periodStart)).toEqual([
        MARCH,
        APRIL,
      ])
      expect(revised.version).toMatchObject({ version: 2, effectiveFrom: MAY })
      expect(repository.revise).toHaveBeenCalledWith(
        expect.objectContaining({ supersedeRowlessHead: false }),
      )
    })

    it('reads the goal again when the hourly job opened the due month first', async () => {
      const { created, repository, revise, setNow } = await scansGoal()
      setNow(new Date('2026-04-01T00:10:00.000Z'))
      // The job's write lands between this command's read and its own attempt:
      // nothing is left to insert, and the bundle in hand is a month behind.
      const aprilByTheJob = {
        ...created.results[0]!,
        id: 'april-by-the-job',
        periodStart: APRIL,
        periodEnd: MAY,
      }
      vi.mocked(repository.appendResults).mockResolvedValueOnce(0)
      vi.mocked(repository.get)
        .mockResolvedValueOnce(created)
        .mockResolvedValueOnce({
          ...created,
          results: [...created.results, aprilByTheJob],
        })

      const revised = await revise()

      expect(revised.results.map(({ periodStart }) => periodStart)).toEqual([
        MARCH,
        APRIL,
      ])
      expect(revised.version).toMatchObject({ version: 2, effectiveFrom: MAY })
    })

    it('changing subjects right after a month begins opens that month first', async () => {
      const { created, repository, addPortal, setNow } = await scansGoal()
      setNow(new Date('2026-04-01T00:10:00.000Z'))

      await expect(addPortal(2, 1)).resolves.toMatchObject({
        currentVersion: 2,
        effectiveFrom: MAY,
      })

      expect(repository.appendResults).toHaveBeenCalledWith(
        expect.objectContaining({
          results: [
            expect.objectContaining({
              programVersionId: created.version.id,
              periodStart: APRIL,
            }),
          ],
        }),
      )
      expect(repository.revise).toHaveBeenCalledWith(
        expect.objectContaining({ supersedeRowlessHead: false }),
      )
    })

    it('a pending change whose month has begun is opened, not replaced', async () => {
      const { repository, revise, setNow } = await scansGoal()
      setNow(MID_MARCH)
      const pending = await revise()
      expect(pending.version).toMatchObject({ version: 2, effectiveFrom: APRIL })
      setNow(new Date('2026-04-01T00:10:00.000Z'))

      const next = await revise({ targetValue: 140 })

      // April opens under the change that was waiting for it, and the new
      // change follows it in May.
      expect(repository.appendResults).toHaveBeenCalledWith(
        expect.objectContaining({
          results: [
            expect.objectContaining({
              programVersionId: pending.version.id,
              periodStart: APRIL,
            }),
          ],
        }),
      )
      expect(next.version).toMatchObject({ version: 3, effectiveFrom: MAY })
      expect(repository.revise).toHaveBeenLastCalledWith(
        expect.objectContaining({ supersedeRowlessHead: false }),
      )
    })

    it('reports a month opened under the pending change since the read as a conflict', async () => {
      const { repository, revise, setNow } = await scansGoal()
      setNow(MID_MARCH)
      await revise()
      // The repository finds a month under the head it was told to replace.
      vi.mocked(repository.revise).mockResolvedValueOnce(false)

      await expect(revise({ targetValue: 140 })).rejects.toMatchObject({
        code: 'revision_conflict',
      })
    })

    it('a supersede after a time-zone change starts at a real local month start', async () => {
      const { created, repository, subjects, revise } = await scansGoal(MID_MARCH)
      expect(created.version).toMatchObject({
        propertyTimezone: 'UTC',
        effectiveFrom: APRIL,
      })
      vi.mocked(subjects.getTimezone).mockResolvedValue('Europe/Sofia')

      const revised = await revise()

      // 1 April 00:00 UTC is 03:00 in Sofia: that local month has begun, so
      // the goal now starts with Sofia's May. The start is never copied.
      expect(revised.version).toMatchObject({
        propertyTimezone: 'Europe/Sofia',
        effectiveFrom: new Date('2026-04-30T21:00:00.000Z'),
      })
      expect(repository.revise).toHaveBeenCalledWith(
        expect.objectContaining({ supersedeRowlessHead: true }),
      )
      expect(revised.versions[0]).toMatchObject({
        effectiveFrom: APRIL,
        effectiveTo: APRIL,
      })
    })

    it('a change of subjects before the start keeps the version time zone and its month', async () => {
      const { created, subjects, addPortal, revisions } = await scansGoal(MID_MARCH)
      vi.mocked(subjects.getTimezone).mockResolvedValue('Europe/Sofia')

      await expect(addPortal(2, 1)).resolves.toMatchObject({
        currentVersion: 2,
        effectiveFrom: APRIL,
      })

      expect(revisions()[0]?.[0]).toMatchObject({
        supersedeRowlessHead: true,
        expectedVersion: { id: created.version.id },
        version: { propertyTimezone: 'UTC', effectiveFrom: APRIL },
      })
    })

    it('revise without a note stores the default reason', async () => {
      const { revise, addPortal, revisions, setNow } = await scansGoal()
      setNow(MID_MARCH)

      await revise()
      await addPortal(2, 2)
      await revise({ reason: '  Agreed with the owner  ', targetValue: 140 })
      await addPortal(3, 4, '   ')
      await addPortal(4, 5, ' Seasonal portal ')

      expect(revisions().map(([input]) => input.version.changeReason)).toEqual([
        'revised',
        'subjects_changed',
        'Agreed with the owner',
        'subjects_changed',
        'Seasonal portal',
      ])
    })

    it('a status change without a note stores no status reason', async () => {
      const { service, repository, created } = await scansGoal()
      const changeStatus = (status: 'paused' | 'active', reason?: string) =>
        service.changeStatus(
          { propertyId: 'property-1', programId: created.program.id, status, reason },
          actor,
        )

      await expect(changeStatus('paused')).resolves.toMatchObject({
        status: 'paused',
        statusReason: null,
      })
      await expect(changeStatus('active', '   ')).resolves.toMatchObject({
        status: 'active',
        statusReason: null,
      })
      await expect(changeStatus('paused', ' Closed for works ')).resolves.toMatchObject({
        statusReason: 'Closed for works',
      })
      expect(
        vi.mocked(repository.changeStatus).mock.calls.map(([input]) => input.reason),
      ).toEqual([null, null, 'Closed for works'])
    })

    it('reports a status change the repository could not apply as a conflict', async () => {
      const { service, repository, created } = await scansGoal()
      vi.mocked(repository.changeStatus).mockResolvedValueOnce(null)

      await expect(
        service.changeStatus(
          { propertyId: 'property-1', programId: created.program.id, status: 'ended' },
          actor,
        ),
      ).rejects.toMatchObject({ code: 'revision_conflict' })
    })

    it('revise refuses a subject another goal holds for the measure', async () => {
      const { created, repository, revise, setNow } = await scansGoal()
      setNow(MID_MARCH)
      vi.mocked(repository.findAssignmentConflicts).mockResolvedValueOnce([
        { subject: portal(2), programId: 'program-busy', effectiveTo: null },
      ])

      await expect(
        revise({ metric: 'portal_rating_count', subjects: [portal(1), portal(2)] }),
      ).rejects.toMatchObject({ code: 'subject_has_goal' })

      // Asked for the measure and month the change would take, without the
      // goal's own assignments.
      expect(repository.findAssignmentConflicts).toHaveBeenLastCalledWith({
        organizationId: 'org-1',
        propertyId: 'property-1',
        excludeProgramId: created.program.id,
        metric: 'portal_rating_count',
        effectiveFrom: APRIL,
        subjects: [portal(1), portal(2)],
      })
      expect(repository.revise).not.toHaveBeenCalled()
    })

    it('revise refuses a form opened on a version that has since changed', async () => {
      const { repository, revise, addPortal, setNow } = await scansGoal()
      setNow(MID_MARCH)
      await addPortal(2, 1)

      await expect(revise({ expectedVersion: 1 })).rejects.toMatchObject({
        code: 'revision_conflict',
      })
      expect(repository.revise).toHaveBeenCalledOnce()

      await expect(
        revise({ expectedVersion: 2, subjects: [portal(1), portal(2)] }),
      ).resolves.toMatchObject({ version: { version: 3 } })
    })

    it('rename changes name only and leaves the version untouched', async () => {
      const { service, repository, policy, created } = await scansGoal()

      await expect(
        service.rename(
          {
            propertyId: 'property-1',
            programId: created.program.id,
            name: '  Lobby scans  ',
          },
          actor,
        ),
      ).resolves.toMatchObject({ name: 'Lobby scans', description: null })

      expect(policy.authorize).toHaveBeenLastCalledWith(
        expect.objectContaining({ action: 'goal.update', propertyId: 'property-1' }),
      )
      expect(repository.rename).toHaveBeenCalledWith({
        organizationId: 'org-1',
        propertyId: 'property-1',
        programId: created.program.id,
        name: 'Lobby scans',
        description: null,
        previousName: 'Portal scans',
        previousDescription: null,
        actorId: 'manager-1',
        at: MARCH,
      })
      expect(repository.revise).not.toHaveBeenCalled()
      await expect(
        service.get({ propertyId: 'property-1', programId: created.program.id }, actor),
      ).resolves.toMatchObject({
        program: { name: 'Lobby scans', currentVersion: 1 },
        version: { id: created.version.id, version: 1, changeReason: 'created' },
        versions: [{ id: created.version.id }],
      })
    })

    it('rename keeps a description that is not sent and clears an empty one', async () => {
      const { service, created } = await scansGoal()
      const rename = (name: string, description?: string | null) =>
        service.rename(
          { propertyId: 'property-1', programId: created.program.id, name, description },
          actor,
        )

      await expect(rename('Lobby scans', ' Counted at the desk ')).resolves.toMatchObject(
        { description: 'Counted at the desk' },
      )
      await expect(rename('Front desk scans')).resolves.toMatchObject({
        name: 'Front desk scans',
        description: 'Counted at the desk',
      })
      await expect(rename('Front desk scans', '  ')).resolves.toMatchObject({
        description: null,
      })
    })

    it('rename hands over the name and description it read, so the write applies only to them', async () => {
      const { service, repository, created } = await scansGoal()
      const rename = (name: string, description?: string | null) =>
        service.rename(
          { propertyId: 'property-1', programId: created.program.id, name, description },
          actor,
        )
      await rename('Lobby scans', 'Counted at the desk')

      await rename('Lobby scans', 'Counted at the front desk')

      expect(repository.rename).toHaveBeenLastCalledWith(
        expect.objectContaining({
          name: 'Lobby scans',
          description: 'Counted at the front desk',
          previousName: 'Lobby scans',
          previousDescription: 'Counted at the desk',
        }),
      )
    })

    it('rename refuses a blank or overlong name and writes nothing for an unchanged one', async () => {
      const { service, repository, created } = await scansGoal()
      const rename = (name: string) =>
        service.rename(
          { propertyId: 'property-1', programId: created.program.id, name },
          actor,
        )

      await expect(rename('   ')).rejects.toMatchObject({ code: 'invalid_name' })
      await expect(rename('x'.repeat(201))).rejects.toMatchObject({
        code: 'invalid_name',
      })
      await expect(rename(' Portal scans ')).resolves.toMatchObject({
        name: 'Portal scans',
      })
      expect(repository.rename).not.toHaveBeenCalled()

      // The goal ended, or was renamed, between the read and the write.
      vi.mocked(repository.rename).mockResolvedValueOnce(null)
      await expect(rename('Lobby scans')).rejects.toMatchObject({
        code: 'revision_conflict',
      })
    })
  })

  it('surfaces repository CAS loss as a revision conflict', async () => {
    const { service, repository, setNow } = setup()
    const created = await service.create(
      {
        propertyId: 'property-1',
        name: 'Portal scans',
        metric: 'qualified_scans',
        targetValue: 100,
        subjects: [{ kind: 'portal', portalId: 'portal-1' }],
      },
      actor,
    )
    setNow(new Date('2026-03-15T12:00:00.000Z'))
    vi.mocked(repository.revise).mockResolvedValueOnce(false)

    await expect(
      service.changeAssignments(
        {
          propertyId: 'property-1',
          programId: created.program.id,
          expectedVersion: 1,
          add: [{ kind: 'portal', portalId: 'portal-2' }],
          remove: [],
          selectAllCurrentPortals: false,
          reason: 'Add a portal',
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'revision_conflict' })
  })

  it('does not mint a version for no-ops or leave a Program without a subject', async () => {
    const { service, repository, setNow } = setup()
    const created = await service.create(
      {
        propertyId: 'property-1',
        name: 'Portal scans',
        metric: 'qualified_scans',
        targetValue: 100,
        subjects: [{ kind: 'portal', portalId: 'portal-1' }],
      },
      actor,
    )
    setNow(new Date('2026-03-15T12:00:00.000Z'))

    await expect(
      service.changeAssignments(
        {
          propertyId: 'property-1',
          programId: created.program.id,
          expectedVersion: 1,
          add: [{ kind: 'portal', portalId: 'portal-1' }],
          remove: [{ kind: 'portal', portalId: 'not-assigned' }],
          selectAllCurrentPortals: false,
          reason: 'No effective change',
        },
        actor,
      ),
    ).resolves.toMatchObject({
      currentVersion: 1,
      effectiveFrom: null,
      outcomes: [{ outcome: 'already_assigned' }, { outcome: 'not_assigned' }],
    })
    await expect(
      service.changeAssignments(
        {
          propertyId: 'property-1',
          programId: created.program.id,
          expectedVersion: 1,
          add: [],
          remove: [{ kind: 'portal', portalId: 'portal-1' }],
          selectAllCurrentPortals: false,
          reason: 'Cannot remove the final subject',
        },
        actor,
      ),
    ).resolves.toMatchObject({
      currentVersion: 1,
      effectiveFrom: null,
      outcomes: [{ outcome: 'last_assignment_required' }],
    })
    expect(repository.revise).not.toHaveBeenCalled()
  })

  it('materializes a revised version only when its effective month starts', async () => {
    const { service, repository, setNow } = setup()
    const created = await service.create(
      {
        propertyId: 'property-1',
        name: 'Monthly ratings',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: [{ kind: 'portal', portalId: 'portal-1' }],
      },
      actor,
    )
    await service.revise(
      {
        propertyId: 'property-1',
        programId: created.program.id,
        metric: 'portal_rating_average',
        targetValue: 4.5,
        subjects: [{ kind: 'portal', portalId: 'portal-1' }],
        reason: 'Use the average next month',
      },
      actor,
    )

    await expect(service.maintain()).resolves.toMatchObject({ scheduledResults: 0 })
    expect(repository.appendResults).not.toHaveBeenCalled()

    setNow(new Date('2026-04-01T00:00:00.000Z'))
    await expect(service.maintain()).resolves.toMatchObject({
      scheduledResults: 1,
      failed: 0,
    })
    expect(repository.appendResults).toHaveBeenCalledOnce()
    expect(repository.appendResults).toHaveBeenCalledWith(
      expect.objectContaining({
        results: [
          expect.objectContaining({
            programVersionId: expect.any(String),
            periodStart: new Date('2026-04-01T00:00:00.000Z'),
            periodEnd: new Date('2026-05-01T00:00:00.000Z'),
          }),
        ],
      }),
    )
  })

  it('does not activate a scheduled program before its period or source is ready', async () => {
    const { service } = setup(new Date('2026-03-15T12:00:00.000Z'))
    const created = await service.create(
      {
        propertyId: 'property-1',
        name: 'April ratings',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: [{ kind: 'portal', portalId: 'portal-1' }],
      },
      actor,
    )
    expect(created.program.status).toBe('scheduled')
    await expect(
      service.changeStatus(
        {
          propertyId: 'property-1',
          programId: created.program.id,
          status: 'active',
          reason: 'too early',
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'metric_unavailable' })
  })

  it('pauses future scheduling without abandoning an already-open monthly result', async () => {
    const { service, metrics, repository, setNow } = setup()
    const created = await service.create(
      {
        propertyId: 'property-1',
        name: 'March ratings',
        metric: 'portal_rating_count',
        targetValue: 20,
        subjects: [{ kind: 'portal', portalId: 'portal-1' }],
      },
      actor,
    )
    await service.changeStatus(
      {
        propertyId: 'property-1',
        programId: created.program.id,
        status: 'paused',
        reason: 'Pause after the March period',
      },
      actor,
    )
    setNow(new Date('2026-04-02T01:00:00.000Z'))
    vi.mocked(metrics.queryGoalMetric).mockResolvedValue({
      definitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
      metricKey: 'portal.rating_count',
      state: 'eligible',
      exactValue: 20,
      sampleCount: 20,
      minimumSample: 0,
      sourceCompleteThrough: new Date('2026-04-01T00:00:00.000Z'),
      reason: null,
    })

    await expect(service.maintain()).resolves.toMatchObject({
      inspected: 0,
      scheduledResults: 0,
      reconciled: 1,
      failed: 0,
    })
    await expect(service.maintain()).resolves.toMatchObject({
      inspected: 0,
      scheduledResults: 0,
      reconciled: 1,
      closed: 1,
      failed: 0,
    })
    expect(repository.appendResults).not.toHaveBeenCalled()
  })

  // The Closing phase can pause only an active program and the database has no
  // scheduled -> paused edge. So once a closure is requested nothing may put a
  // program into `active` again: Goal's purge-readiness check would find it
  // there on every pass and the Organization would stay in `closing` for good.
  describe('an Organization whose closure the lifecycle holds', () => {
    const definition = {
      propertyId: 'property-1',
      name: 'March ratings',
      metric: 'portal_rating_count' as const,
      targetValue: 20,
      subjects: [{ kind: 'portal' as const, portalId: 'portal-1' }],
    }
    const change = (programId: string, status: 'paused' | 'active' | 'ended') => ({
      propertyId: 'property-1',
      programId,
      status,
    })

    it('creates no goal', async () => {
      const { service, repository, holdOrganization } = setup()
      holdOrganization()

      await expect(service.create(definition, actor)).rejects.toMatchObject({
        name: 'GoalProgramError',
        code: 'organization_closing',
      })

      expect(repository.isOrganizationHeld).toHaveBeenCalledExactlyOnceWith('org-1')
      expect(repository.create).not.toHaveBeenCalled()
    })

    it('does not resume a goal its Closing phase paused', async () => {
      const { service, repository, holdOrganization } = setup()
      const created = await service.create(definition, actor)
      await service.changeStatus(change(created.program.id, 'paused'), actor)
      vi.mocked(repository.isOrganizationHeld).mockClear()
      holdOrganization()

      await expect(
        service.changeStatus(change(created.program.id, 'active'), actor),
      ).rejects.toMatchObject({ name: 'GoalProgramError', code: 'organization_closing' })

      expect(repository.changeStatus).toHaveBeenCalledTimes(1)
      expect(repository.isOrganizationHeld).toHaveBeenCalledExactlyOnceWith('org-1')
    })

    it('does not start a goal that is still scheduled', async () => {
      const { service, repository, holdOrganization } = setup(
        new Date('2026-03-15T12:00:00.000Z'),
      )
      const created = await service.create(definition, actor)
      expect(created.program.status).toBe('scheduled')
      holdOrganization()

      await expect(
        service.changeStatus(change(created.program.id, 'active'), actor),
      ).rejects.toMatchObject({ name: 'GoalProgramError', code: 'organization_closing' })

      expect(repository.changeStatus).not.toHaveBeenCalled()
    })

    it('still pauses and ends a goal, which only stops work', async () => {
      const { service, holdOrganization } = setup()
      const created = await service.create(definition, actor)
      holdOrganization()

      await expect(
        service.changeStatus(change(created.program.id, 'paused'), actor),
      ).resolves.toMatchObject({ status: 'paused' })
      await expect(
        service.changeStatus(change(created.program.id, 'ended'), actor),
      ).resolves.toMatchObject({ status: 'ended' })
    })

    it('does not ask the lifecycle about a change that is not a start', async () => {
      const { service, repository } = setup()
      const created = await service.create(definition, actor)
      vi.mocked(repository.isOrganizationHeld).mockClear()

      await service.changeStatus(change(created.program.id, 'paused'), actor)

      expect(repository.isOrganizationHeld).not.toHaveBeenCalled()
    })
  })

  it('retains terminal Program history and denies later assignment changes', async () => {
    const { service } = setup()
    const created = await service.create(
      {
        propertyId: 'property-1',
        name: 'March ratings',
        metric: 'portal_rating_count',
        targetValue: 20,
        subjects: [{ kind: 'portal', portalId: 'portal-1' }],
      },
      actor,
    )
    await expect(
      service.changeStatus(
        {
          propertyId: 'property-1',
          programId: created.program.id,
          status: 'ended',
          reason: 'Program archived by manager',
        },
        actor,
      ),
    ).resolves.toMatchObject({ status: 'ended' })
    await expect(
      service.get({ propertyId: 'property-1', programId: created.program.id }, actor),
    ).resolves.toMatchObject({
      program: { status: 'ended' },
      results: [{ id: created.results[0]?.id }],
    })
    await expect(
      service.changeAssignments(
        {
          propertyId: 'property-1',
          programId: created.program.id,
          expectedVersion: 1,
          add: [{ kind: 'portal', portalId: 'portal-2' }],
          remove: [],
          selectAllCurrentPortals: false,
          reason: 'Should not change archived history',
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'invalid_transition' })
  })

  it('activates due programs and materializes only the month that has started', async () => {
    const { service, repository, setNow } = setup(new Date('2026-03-15T12:00:00.000Z'))
    await service.create(
      {
        propertyId: 'property-1',
        name: 'April ratings',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: [
          { kind: 'portal', portalId: 'portal-1' },
          { kind: 'portal', portalId: 'portal-2' },
        ],
      },
      actor,
    )
    setNow(new Date('2026-04-01T00:00:00.000Z'))

    await expect(service.maintain()).resolves.toMatchObject({
      inspected: 1,
      activated: 1,
      scheduledResults: 2,
      unavailable: 0,
      failed: 0,
    })
    expect(repository.activate).toHaveBeenCalledOnce()
    expect(repository.appendResults).not.toHaveBeenCalled()
  })

  it('fails the job after partial infrastructure failure so BullMQ can retry it', async () => {
    const { service, repository, setNow } = setup(new Date('2026-03-15T12:00:00.000Z'))
    await service.create(
      {
        propertyId: 'property-1',
        name: 'April ratings',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: [{ kind: 'portal', portalId: 'portal-1' }],
      },
      actor,
    )
    setNow(new Date('2026-04-01T00:00:00.000Z'))
    vi.mocked(repository.activate).mockRejectedValueOnce(new Error('db down'))

    await expect(service.maintain()).rejects.toMatchObject({
      name: 'GoalProgramMaintenanceError',
      stats: { inspected: 1, failed: 1 },
    })
  })

  describe('a failed maintenance run', () => {
    async function failingActivation(failure: unknown) {
      const { service, repository, setNow } = setup(new Date('2026-03-15T12:00:00.000Z'))
      await service.create(
        {
          propertyId: 'property-1',
          name: 'April ratings',
          metric: 'portal_rating_count',
          targetValue: 25,
          subjects: [{ kind: 'portal', portalId: 'portal-1' }],
        },
        actor,
      )
      setNow(new Date('2026-04-01T00:00:00.000Z'))
      vi.mocked(repository.activate).mockRejectedValueOnce(failure)
      return service.maintain()
    }

    it('names the SQL state of a database refusal in the error, with no identifier', async () => {
      const refusal = Object.assign(new Error('Failed query: update "goal_programs"'), {
        cause: Object.assign(new Error('guard'), { code: '23514' }),
      })

      await expect(failingActivation(refusal)).rejects.toMatchObject({
        name: 'GoalProgramMaintenanceError',
        message: 'Goal Program maintenance had 1 failed operation(s): sqlstate_23514 x1',
        stats: { failed: 1, failureCauses: { sqlstate_23514: 1 } },
      })
    })

    it('names the error class of any other failure', async () => {
      await expect(failingActivation(new TypeError('db down'))).rejects.toMatchObject({
        message: 'Goal Program maintenance had 1 failed operation(s): TypeError x1',
        stats: { failed: 1, failureCauses: { TypeError: 1 } },
      })
    })
  })

  describe('a due result another run settled first', () => {
    async function dueResult() {
      const { service, repository, setNow } = setup()
      await service.create(
        {
          propertyId: 'property-1',
          name: 'March ratings',
          metric: 'portal_rating_count',
          targetValue: 25,
          subjects: [{ kind: 'portal', portalId: 'portal-1' }],
        },
        actor,
      )
      setNow(new Date('2026-04-03T00:00:00.000Z'))
      return { service, repository }
    }

    it('is a lost race and not a failure when it is already closed', async () => {
      const { service, repository } = await dueResult()
      vi.mocked(repository.getDueResult).mockResolvedValue(null)

      await expect(service.maintain()).resolves.toMatchObject({
        raced: 1,
        reconciled: 0,
        failed: 0,
      })
    })

    it('is a lost race and not a failure when its compare-and-set loses', async () => {
      const { service, repository } = await dueResult()
      vi.mocked(repository.updateResult).mockResolvedValue(null)

      await expect(service.maintain()).resolves.toMatchObject({
        raced: 1,
        reconciled: 0,
        failed: 0,
      })
    })
  })

  // A result whose month runs past its version or assignment window can never
  // be updated: the database guard rejects every write. Before revisions
  // respected the open month, a timezone move could leave one behind, and it
  // failed every hourly run for every tenant.
  it('reports a result stranded outside its version window without failing the run', async () => {
    const { service, repository, setNow } = setup()
    const created = await service.create(
      {
        propertyId: 'property-1',
        name: 'Monthly ratings',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: [{ kind: 'portal', portalId: 'portal-1' }],
      },
      actor,
    )
    const closedEarly = {
      ...created.version,
      effectiveTo: new Date('2026-03-31T21:00:00.000Z'),
    }
    vi.mocked(repository.getVersion).mockResolvedValue(closedEarly)
    vi.mocked(repository.updateResult).mockRejectedValue(
      Object.assign(new Error('goal monthly result falls outside its window'), {
        code: '23514',
      }),
    )
    setNow(new Date('2026-04-03T00:00:00.000Z'))

    await expect(service.maintain()).resolves.toMatchObject({
      reconciled: 0,
      stranded: 1,
      failed: 0,
    })
    expect(repository.updateResult).not.toHaveBeenCalled()
  })

  it('moves a due result through reconciling before immutable closure', async () => {
    const reconciliationTime = new Date('2026-04-02T01:00:00.000Z')
    const setupResult = setup()
    const { service, metrics, repository, setNow } = setupResult
    const bundle = await service.create(
      {
        propertyId: 'property-1',
        name: 'March ratings',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: [{ kind: 'portal', portalId: 'portal-1' }],
      },
      actor,
    )
    const result = bundle.results[0]
    if (!result) throw new Error('expected monthly result')
    setNow(reconciliationTime)
    vi.mocked(metrics.queryGoalMetric).mockResolvedValue({
      definitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
      metricKey: 'portal.rating_count',
      state: 'eligible',
      exactValue: 26,
      sampleCount: 26,
      minimumSample: 0,
      sourceCompleteThrough: new Date('2026-04-01T00:00:00.000Z'),
      reason: null,
    })

    const reconciling = await service.reconcileResult({
      organizationId: actor.organizationId,
      propertyId: 'property-1',
      resultId: result.id,
    })
    expect(reconciling.status).toBe('reconciling')
    expect(reconciling.evaluation).toMatchObject({
      state: 'eligible',
      value: 26,
      achieved: true,
    })

    const closed = await service.reconcileResult({
      organizationId: actor.organizationId,
      propertyId: 'property-1',
      resultId: result.id,
    })
    expect(closed.status).toBe('closed')
    expect(closed.closedAt).toEqual(reconciliationTime)

    vi.mocked(metrics.queryGoalMetric).mockResolvedValue({
      definitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
      metricKey: 'portal.rating_count',
      state: 'eligible',
      exactValue: 20,
      sampleCount: 20,
      minimumSample: 0,
      sourceCompleteThrough: new Date('2026-04-01T00:00:00.000Z'),
      reason: null,
    })
    const corrected = await service.reconcileClosedResult({
      organizationId: actor.organizationId,
      propertyId: 'property-1',
      resultId: result.id,
    })
    expect(corrected).toMatchObject({
      status: 'revised',
      result: {
        status: 'closed',
        evaluation: { state: 'eligible', value: 20, achieved: false },
        closedAt: reconciliationTime,
      },
      revision: { revision: 1, changeReason: 'metric_correction_reconciliation' },
      outcomeChanged: true,
      availabilityChanged: false,
    })
    expect(repository.updateResult).toHaveBeenCalledTimes(2)

    await expect(
      service.reconcileClosedResult({
        organizationId: actor.organizationId,
        propertyId: 'property-1',
        resultId: result.id,
      }),
    ).resolves.toMatchObject({ status: 'unchanged' })
  })

  it('keeps an eligible result reconciling until Metric is complete through period end', async () => {
    const { service, metrics, setNow } = setup()
    const bundle = await service.create(
      {
        propertyId: 'property-1',
        name: 'March ratings',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: [{ kind: 'portal', portalId: 'portal-1' }],
      },
      actor,
    )
    const result = bundle.results[0]!
    setNow(new Date('2026-04-02T00:00:00.000Z'))
    vi.mocked(metrics.queryGoalMetric).mockResolvedValue({
      definitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
      metricKey: 'portal.rating_count',
      state: 'eligible',
      exactValue: 26,
      sampleCount: 26,
      minimumSample: 0,
      sourceCompleteThrough: new Date('2026-03-31T23:59:59.999Z'),
      reason: null,
    })

    await expect(
      service.reconcileResult({
        organizationId: actor.organizationId,
        propertyId: 'property-1',
        resultId: result.id,
      }),
    ).resolves.toMatchObject({ status: 'reconciling', closedAt: null })
    await expect(
      service.reconcileResult({
        organizationId: actor.organizationId,
        propertyId: 'property-1',
        resultId: result.id,
      }),
    ).resolves.toMatchObject({ status: 'reconciling', closedAt: null })

    vi.mocked(metrics.queryGoalMetric).mockResolvedValue({
      definitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
      metricKey: 'portal.rating_count',
      state: 'eligible',
      exactValue: 26,
      sampleCount: 26,
      minimumSample: 0,
      sourceCompleteThrough: result.periodEnd,
      reason: null,
    })
    await expect(
      service.reconcileResult({
        organizationId: actor.organizationId,
        propertyId: 'property-1',
        resultId: result.id,
      }),
    ).resolves.toMatchObject({
      status: 'closed',
      sourceCompleteThrough: result.periodEnd,
      closedAt: new Date('2026-04-02T00:00:00.000Z'),
    })
  })

  it('keeps an unavailable result with unknown source completeness reconciling', async () => {
    const { service, metrics, setNow } = setup()
    const bundle = await service.create(
      {
        propertyId: 'property-1',
        name: 'March ratings',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: [{ kind: 'portal', portalId: 'portal-1' }],
      },
      actor,
    )
    const result = bundle.results[0]!
    setNow(new Date('2026-04-02T00:00:00.000Z'))
    vi.mocked(metrics.queryGoalMetric).mockResolvedValue({
      definitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
      metricKey: 'portal.rating_count',
      state: 'unavailable',
      exactValue: null,
      sampleCount: 0,
      minimumSample: 0,
      sourceCompleteThrough: null,
      reason: 'metric_source_unavailable',
    })

    await service.reconcileResult({
      organizationId: actor.organizationId,
      propertyId: 'property-1',
      resultId: result.id,
    })
    await expect(
      service.reconcileResult({
        organizationId: actor.organizationId,
        propertyId: 'property-1',
        resultId: result.id,
      }),
    ).resolves.toMatchObject({
      status: 'reconciling',
      evaluation: { state: 'unavailable', achieved: null },
      sourceCompleteThrough: null,
      closedAt: null,
    })
  })

  it('closes a verified zero count at the exact time and source boundaries', async () => {
    const { service, metrics, repository, setNow } = setup()
    const bundle = await service.create(
      {
        propertyId: 'property-1',
        name: 'March ratings',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: [{ kind: 'portal', portalId: 'portal-1' }],
      },
      actor,
    )
    const result = bundle.results[0]!
    setNow(new Date('2026-04-02T00:00:00.000Z'))
    vi.mocked(metrics.queryGoalMetric).mockResolvedValue({
      definitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
      metricKey: 'portal.rating_count',
      state: 'eligible',
      exactValue: 0,
      sampleCount: 0,
      minimumSample: 0,
      sourceCompleteThrough: result.periodEnd,
      reason: null,
    })

    await expect(
      service.reconcileResult({
        organizationId: actor.organizationId,
        propertyId: 'property-1',
        resultId: result.id,
      }),
    ).resolves.toMatchObject({ status: 'reconciling' })
    await expect(
      service.reconcileResult({
        organizationId: actor.organizationId,
        propertyId: 'property-1',
        resultId: result.id,
      }),
    ).resolves.toMatchObject({
      status: 'closed',
      evaluation: { state: 'eligible', value: 0, achieved: false },
      sourceCompleteThrough: result.periodEnd,
      closedAt: new Date('2026-04-02T00:00:00.000Z'),
    })
    expect(repository.updateResult).toHaveBeenCalledTimes(2)
  })

  describe('which target a month is judged against', () => {
    const PROPERTY = 'property-1'
    const DUE = new Date('2026-04-02T01:00:00.000Z')

    /** A March ratings goal with a version target of 25, read after March ends. */
    async function marchRatingsGoal(monthTarget: number | null) {
      const context = setup()
      const bundle = await context.service.create(
        {
          propertyId: PROPERTY,
          name: 'March ratings',
          metric: 'portal_rating_count',
          targetValue: 25,
          subjects: [{ kind: 'portal', portalId: 'portal-1' }],
        },
        actor,
      )
      const opened = bundle.results[0]
      if (!opened) throw new Error('expected monthly result')
      // Nothing in the service sets a month's own target yet, so the stored row
      // is given one directly, as the database row would carry it.
      context.results.set(opened.id, { ...opened, targetValue: monthTarget })
      context.setNow(DUE)
      const reference = {
        organizationId: actor.organizationId,
        propertyId: PROPERTY,
        resultId: opened.id,
      }
      const countIs = (count: number) =>
        vi.mocked(context.metrics.queryGoalMetric).mockResolvedValue({
          definitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
          metricKey: 'portal.rating_count',
          state: 'eligible',
          exactValue: count,
          sampleCount: count,
          minimumSample: 0,
          sourceCompleteThrough: opened.periodEnd,
          reason: null,
        })
      return { ...context, reference, countIs }
    }

    it("a month with its own target is judged against it, not the version's", async () => {
      const { service, reference, countIs } = await marchRatingsGoal(30)
      // 26 ratings meet the version's 25 but not the month's own 30.
      countIs(26)

      const reconciling = await service.reconcileResult(reference)

      expect(reconciling).toMatchObject({
        status: 'reconciling',
        targetValue: 30,
        evaluation: { state: 'eligible', value: 26, achieved: false },
      })
    })

    it('a row with its own target closes against it', async () => {
      const { service, reference, countIs } = await marchRatingsGoal(20)
      // 22 ratings miss the version's 25 but meet the month's own 20.
      countIs(22)

      await service.reconcileResult(reference)
      const closed = await service.reconcileResult(reference)

      expect(closed).toMatchObject({
        status: 'closed',
        targetValue: 20,
        evaluation: { state: 'eligible', value: 22, achieved: true },
      })
    })

    it("a closed-month correction keeps using the month's own target", async () => {
      const { service, reference, countIs } = await marchRatingsGoal(20)
      countIs(22)
      await service.reconcileResult(reference)
      await service.reconcileResult(reference)
      // One rating is retracted after the month closed: 21 still meets the
      // month's own 20, and would miss the version's 25.
      countIs(21)

      const corrected = await service.reconcileClosedResult(reference)

      expect(corrected).toMatchObject({
        status: 'revised',
        result: {
          status: 'closed',
          targetValue: 20,
          evaluation: { state: 'eligible', value: 21, achieved: true },
        },
        outcomeChanged: false,
      })
    })

    it("a month without its own target uses the version's", async () => {
      const { service, reference, countIs } = await marchRatingsGoal(null)
      countIs(22)

      await service.reconcileResult(reference)
      const closed = await service.reconcileResult(reference)

      expect(closed).toMatchObject({
        status: 'closed',
        targetValue: null,
        evaluation: { state: 'eligible', value: 22, achieved: false },
      })
      countIs(26)
      await expect(service.reconcileClosedResult(reference)).resolves.toMatchObject({
        status: 'revised',
        result: { evaluation: { value: 26, achieved: true } },
        outcomeChanged: true,
      })
    })
  })

  it('preserves the last closed result while a late correction is still updating', async () => {
    const setupResult = setup()
    const { service, metrics, repository, setNow } = setupResult
    const bundle = await service.create(
      {
        propertyId: 'property-1',
        name: 'March scans',
        metric: 'qualified_scans',
        targetValue: 25,
        subjects: [{ kind: 'portal', portalId: 'portal-1' }],
      },
      actor,
    )
    const result = bundle.results[0]!
    setNow(new Date('2026-04-02T01:00:00.000Z'))
    vi.mocked(metrics.queryGoalMetric).mockResolvedValue({
      definitionVersionId: METRIC_VERSION_IDS.qualifiedScanGoal,
      metricKey: 'portal.qualified_scan',
      state: 'eligible',
      exactValue: 30,
      sampleCount: 30,
      minimumSample: 0,
      sourceCompleteThrough: result.periodEnd,
      reason: null,
    })
    await service.reconcileResult({
      organizationId: actor.organizationId,
      propertyId: 'property-1',
      resultId: result.id,
    })
    await service.reconcileResult({
      organizationId: actor.organizationId,
      propertyId: 'property-1',
      resultId: result.id,
    })
    vi.mocked(metrics.queryGoalMetric).mockResolvedValue({
      definitionVersionId: METRIC_VERSION_IDS.qualifiedScanGoal,
      metricKey: 'portal.qualified_scan',
      state: 'updating',
      exactValue: 29,
      sampleCount: 29,
      minimumSample: 0,
      sourceCompleteThrough: null,
      reason: 'source_reconciling',
    })

    await expect(
      service.reconcileClosedResult({
        organizationId: actor.organizationId,
        propertyId: 'property-1',
        resultId: result.id,
      }),
    ).resolves.toMatchObject({ status: 'pending' })
    expect(repository.appendResultRevision).not.toHaveBeenCalled()
  })
})
