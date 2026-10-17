import { describe, expect, it, vi } from 'vitest'
import { createConsumerRegistry } from '#/shared/outbox'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { buildReportingContext, type ReportingContextBuildInput } from './build'

function build(patch: Partial<ReportingContextBuildInput> = {}) {
  const input: ReportingContextBuildInput = {
    db: {} as ReportingContextBuildInput['db'],
    clock: () => new Date('2026-08-27T00:00:00.000Z'),
    idGen: () => '10000000-0000-4000-8000-000000000001',
    logger: createMockLogger(),
    portalGroupApi: {} as ReportingContextBuildInput['portalGroupApi'],
    portalApi: {} as ReportingContextBuildInput['portalApi'],
    reviewRatingLookup: {} as ReportingContextBuildInput['reviewRatingLookup'],
    propertyApi: {} as ReportingContextBuildInput['propertyApi'],
    staffPublicApi: {} as ReportingContextBuildInput['staffPublicApi'],
    reviewServingStats: {} as ReportingContextBuildInput['reviewServingStats'],
    reviewGoogleRatingReads: {} as ReportingContextBuildInput['reviewGoogleRatingReads'],
    inboxTargets: {} as ReportingContextBuildInput['inboxTargets'],
    guestResponseIntegrity: {} as ReportingContextBuildInput['guestResponseIntegrity'],
    ...patch,
  }
  return buildReportingContext(input)
}

describe('buildReportingContext', () => {
  it('exposes metric, Goal Program, and dashboard behavior through one interface', () => {
    const context = build()

    expect(typeof context.publicApi.queryGoalMetric).toBe('function')
    expect(typeof context.publicApi.programs.create).toBe('function')
    expect(typeof context.publicApi.programs.createForSubjects).toBe('function')
    expect(typeof context.publicApi.findMonthlyResultNotificationFacts).toBe('function')
    expect(typeof context.publicApi.getDashboardData).toBe('function')
    expect(typeof context.publicApi.getFleetOverview).toBe('function')
    expect(typeof context.publicApi.getPortalResultsOverview).toBe('function')
    expect(typeof context.publicApi.getPropertySetup).toBe('function')
    expect(typeof context.publicApi.listPropertySetupSummaries).toBe('function')
    expect(Object.keys(context.publicApi.ratingGoals).sort()).toEqual([
      'card',
      'change',
      'defer',
      'detail',
      'end',
      'history',
      'keep',
      'set',
      'setup',
    ])
  })

  it('publishes governed metric reads only, never the raw aggregate query', () => {
    // The aggregate query takes any consumer and any metric key and asks no
    // authority; Goals read through queryGoalMetric, which admits one approved
    // version. Nothing in production called the raw one.
    expect(Object.keys(build().publicApi)).not.toContain('queryAggregate')
  })

  it('owns both reporting consumer families, Goal maintenance and the daily rating goal evaluation', () => {
    const context = build()

    expect(typeof context.worker.registerOutboxConsumers).toBe('function')
    expect(typeof context.worker.programMaintenance.createHandler).toBe('function')
    expect(context.worker.programMaintenance.jobName).toBe('goal-program.maintain')
    expect(typeof context.worker.ratingGoalEvaluation.createHandler).toBe('function')
    expect(context.worker.ratingGoalEvaluation.jobName).toBe('rating-goal.evaluate')
    expect(Object.keys(context.internal.repos).sort()).toEqual([
      'dashboardRepo',
      'goalProgramRepo',
      'propertySetupRepo',
      'setupChecklistRepo',
    ])
  })

  it('evaluates the Google rating goal when Review verifies Google numbers, and ends it on archive', () => {
    const registry = createConsumerRegistry()

    build().worker.registerOutboxConsumers(registry, { authorize: async () => undefined })

    expect(registry.list()).toContainEqual({
      eventType: 'review.google_reputation_snapshot.verified',
      consumerName: 'goal.google-rating-evaluation',
    })
    expect(registry.list()).toContainEqual({
      eventType: 'property.archived',
      consumerName: 'goal.on-property-archived',
    })
  })

  it("composes the portal goal recommendation over Portal's readiness facts and one readings statement", async () => {
    const statements: unknown[] = []
    const tx = {
      execute: vi.fn(async (statement: unknown) => {
        statements.push(statement)
        return { rows: [] }
      }),
    }
    const listGoalReadinessFacts = vi.fn(async () => ({ portals: [], truncated: false }))
    const context = build({
      db: {
        transaction: async (read: (inner: typeof tx) => Promise<unknown>) => read(tx),
      } as unknown as ReportingContextBuildInput['db'],
      portalApi: {
        listGoalReadinessFacts,
      } as unknown as ReportingContextBuildInput['portalApi'],
      propertyApi: {
        getPropertyTimezone: async () => 'Europe/Sofia',
      } as unknown as ReportingContextBuildInput['propertyApi'],
    })
    const authorize = vi.fn(async () => undefined)

    const recommendation = await context.internal.useCases.goalRecommendation.read(
      { authorize },
      { propertyId: 'property-1' },
      { organizationId: 'org-1', userId: 'manager-1', role: 'PropertyManager' },
    )

    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'goal.create' }),
    )
    expect(listGoalReadinessFacts).toHaveBeenCalledWith(
      'org-1',
      'property-1',
      new Date('2026-08-27T00:00:00.000Z'),
    )
    // The statement timeout, then the one readings statement.
    expect(statements).toHaveLength(2)
    expect(recommendation).toMatchObject({
      state: 'no_live_portal',
      timezone: 'Europe/Sofia',
    })
  })

  it("composes the Monthly portal goal's card behind its own goal.create check", async () => {
    const listGoalReadinessFacts = vi.fn(async () => ({ portals: [], truncated: false }))
    const context = build({
      portalApi: {
        listGoalReadinessFacts,
      } as unknown as ReportingContextBuildInput['portalApi'],
    })
    const authorize = vi.fn(async (request: { action: string }) => {
      if (request.action === 'goal.create') throw new Error('refused')
    })

    await expect(
      context.publicApi.programs.monthlyPortalGoal.card(
        { authorize },
        { propertyId: 'property-1' },
        { organizationId: 'org-1', userId: 'manager-1', role: 'PropertyManager' },
      ),
    ).rejects.toThrow('refused')
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'goal.create', propertyId: 'property-1' }),
    )
    expect(listGoalReadinessFacts).not.toHaveBeenCalled()
  })

  it('builds no Organization export or lifecycle contributor of its own', () => {
    // LIF-01: the metric, goal and dashboard contributors are built by
    // composition/organization-export-contributors.ts, never by this build: a
    // second instance here would be read by nothing.
    const context = build()

    expect(Object.keys(context).sort()).toEqual([
      'internal',
      'maintenance',
      'publicApi',
      'worker',
    ])
  })
})
