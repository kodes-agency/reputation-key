import { describe, expect, it } from 'vitest'
import { createConsumerRegistry } from '#/shared/outbox'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { buildReportingContext, type ReportingContextBuildInput } from './build'

function build() {
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
      'detail',
      'end',
      'history',
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

  it('owns both reporting consumer families and Goal maintenance', () => {
    const context = build()

    expect(typeof context.worker.registerOutboxConsumers).toBe('function')
    expect(typeof context.worker.programMaintenance.createHandler).toBe('function')
    expect(context.worker.programMaintenance.jobName).toBe('goal-program.maintain')
    expect(Object.keys(context.internal.repos).sort()).toEqual([
      'dashboardRepo',
      'goalProgramRepo',
      'propertySetupRepo',
      'setupChecklistRepo',
    ])
  })

  it('evaluates the Google rating goal when Review verifies Google numbers', () => {
    const registry = createConsumerRegistry()

    build().worker.registerOutboxConsumers(registry, { authorize: async () => undefined })

    expect(registry.list()).toContainEqual({
      eventType: 'review.google_reputation_snapshot.verified',
      consumerName: 'goal.google-rating-evaluation',
    })
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
