import { describe, expect, it } from 'vitest'
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
    expect(typeof context.publicApi.findMonthlyResultNotificationFacts).toBe('function')
    expect(typeof context.publicApi.getDashboardData).toBe('function')
    expect(typeof context.publicApi.getFleetOverview).toBe('function')
  })

  it('owns both reporting consumer families and Goal maintenance', () => {
    const context = build()

    expect(typeof context.worker.registerOutboxConsumers).toBe('function')
    expect(typeof context.worker.programMaintenance.createHandler).toBe('function')
    expect(context.worker.programMaintenance.jobName).toBe('goal-program.maintain')
    expect(Object.keys(context.internal.repos).sort()).toEqual([
      'dashboardRepo',
      'goalProgramRepo',
      'setupChecklistRepo',
    ])
  })
})
