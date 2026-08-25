import { beforeEach, describe, expect, it, vi } from 'vitest'
import { METRIC_VERSION_IDS } from '#/contexts/metric/application/public-api'
import type { MetricPublicApi } from '#/contexts/metric/application/public-api'
import type {
  GoalMonthlyResult,
  GoalProgramBundle,
  GoalProgramRepository,
} from '../ports/goal-program.repository'
import type { GoalActor, GoalExecutionPolicy } from './governed-goals'
import { createGoalProgramService, GoalProgramError } from './goal-programs'

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
    listOperational: vi.fn(async () => (created ? [created] : [])),
    changeStatus: vi.fn(async () => null),
    revise: vi.fn(async ({ version, assignments, at }) => {
      if (!created) return
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
    }),
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
    },
    getApprovedGoalVersion: vi.fn(async (versionId) =>
      governedVersion(
        versionId,
        versionId === METRIC_VERSION_IDS.portalRatingAverageGoal ? 10 : 0,
      ),
    ),
  }
  const policy: GoalExecutionPolicy = { authorize: vi.fn(async () => undefined) }
  const service = createGoalProgramService({
    repository,
    policy,
    subjects: {
      getTimezone: vi.fn(async () => 'UTC'),
      subjectBelongsToProperty: vi.fn(async () => true),
    },
    metrics,
    id: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    now: () => now,
  })
  return {
    service,
    repository,
    metrics,
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

  it('rejects duplicate subjects and Staff mutation', async () => {
    const { service } = setup()
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
    const { service, metrics, setNow } = setupResult
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
  })
})
