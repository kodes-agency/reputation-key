import { beforeEach, describe, expect, it, vi } from 'vitest'
import { METRIC_VERSION_IDS } from '#/contexts/metric/application/public-api'
import type { MetricPublicApi } from '#/contexts/metric/application/public-api'
import type {
  GoalMonthlyResult,
  GoalProgramBundle,
  GoalProgramRepository,
  GoalResultRevision,
} from '../ports/goal-program.repository'
import type { GoalActor, GoalExecutionPolicy } from '../ports/goal-execution-policy'
import {
  createGoalProgramService,
  GoalProgramError,
  MAX_GOAL_ASSIGNMENT_SELECTIONS,
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
    }),
    get: vi.fn(async () => created),
    list: vi.fn(async () => (created ? [created] : [])),
    listOperational: vi.fn(async () =>
      created && ['scheduled', 'active'].includes(created.program.status)
        ? [created]
        : [],
    ),
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
    revise: vi.fn(async ({ version, assignments, at }) => {
      if (!created) return false
      const previous = created
      created = {
        program: {
          ...previous.program,
          currentVersion: version.version,
          updatedAt: at,
        },
        version,
        versions: [...previous.versions, version],
        assignments: [...previous.assignments, ...assignments],
        results: previous.results,
      }
      for (const assignment of assignments) {
        assignmentHistory.set(assignment.id, assignment)
      }
      versionHistory.set(version.id, version)
      return true
    }),
    findAssignmentConflicts: vi.fn(async () => []),
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
  const metrics: MetricPublicApi = {
    queryAggregate: vi.fn<MetricPublicApi['queryAggregate']>(async () => ({
      sum: 0,
      count: 0,
      max: 0,
      available: true,
      sampleCount: 0,
      minimumSample: 0,
    })),
    queryGoalMetric: vi.fn<MetricPublicApi['queryGoalMetric']>(async (query) => ({
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
    portalAnalytics: {
      getPortalKpiSums: vi.fn(async () => []),
      getPortalRatingDistribution: vi.fn(async () => []),
      getPortalRatingTrend: vi.fn(async () => []),
      getPortalMetricEvidence: vi.fn(async () => {
        throw new Error('Portal analytics is not used by the Goal test')
      }),
    },
    portalLifetime: {
      get: async () => null,
    },
    getCurrentOnGoogle: vi.fn(async () => null),
    findGoalMetricCorrectionImpacts: vi.fn(async () => []),
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

  it('rejects duplicate subjects and policy-denied Staff mutation', async () => {
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
          name: 'Staff cannot create',
          metric: 'portal_rating_count',
          targetValue: 10,
          subjects: [{ kind: 'property', propertyId: 'property-1' }],
        },
        { ...actor, role: 'Staff' },
      ),
    ).rejects.toMatchObject({ code: 'forbidden' } satisfies Partial<GoalProgramError>)
    expect(policy.authorize).toHaveBeenLastCalledWith({
      actor: { ...actor, role: 'Staff' },
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
        { ...actor, role: 'Staff' },
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
      { kind: 'portal', portalId: 'busy-portal' },
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

  it('bounds the resulting assignment set and the audited reason', async () => {
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
          remove: [{ kind: 'portal', portalId: 'portal-0' }],
          selectAllCurrentPortals: false,
          reason: 'x'.repeat(501),
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'invalid_reason' })
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

  it('does not stack a second future revision before the pending month starts', async () => {
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
    await service.changeAssignments(
      {
        propertyId: 'property-1',
        programId: created.program.id,
        expectedVersion: 1,
        add: [{ kind: 'portal', portalId: 'portal-2' }],
        remove: [],
        selectAllCurrentPortals: false,
        reason: 'First pending revision',
      },
      actor,
    )

    await expect(
      service.changeAssignments(
        {
          propertyId: 'property-1',
          programId: created.program.id,
          expectedVersion: 2,
          add: [{ kind: 'portal', portalId: 'portal-3' }],
          remove: [],
          selectAllCurrentPortals: false,
          reason: 'Would skip the pending revision',
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'revision_conflict' })
    await expect(
      service.revise(
        {
          propertyId: 'property-1',
          programId: created.program.id,
          metric: 'qualified_scans',
          targetValue: 120,
          subjects: [{ kind: 'portal', portalId: 'portal-1' }],
          reason: 'Would also skip the pending revision',
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'revision_conflict' })
    expect(repository.revise).toHaveBeenCalledOnce()
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
