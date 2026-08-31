import { describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import type { MetricPublicApi } from '#/contexts/metric/application/public-api'
import type {
  PortalGroupPublicApi,
  PortalPublicApi,
} from '#/contexts/portal/application/public-api'
import type { PropertyFactsPublicApi } from '#/contexts/property/application/public-api'
import { buildGoalContext } from './build'

describe('buildGoalContext', () => {
  function build() {
    return buildGoalContext({
      db: {} as Database,
      metricApi: {} as MetricPublicApi,
      clock: () => new Date('2026-08-27T00:00:00.000Z'),
      idGen: () => '10000000-0000-4000-8000-000000000001',
      propertyApi: {} as PropertyFactsPublicApi,
      portalGroupApi: {} as PortalGroupPublicApi,
      portalApi: {} as PortalPublicApi,
    })
  }

  it('exposes the exact monthly-result notification lookup from Goal ownership', () => {
    const context = build()

    expect(typeof context.publicApi.findMonthlyResultNotificationFacts).toBe('function')
    expect(typeof context.publicApi.findMonthlyResultRevisionNotificationFacts).toBe(
      'function',
    )
    expect(typeof context.worker.registerOutboxConsumers).toBe('function')
    expect(typeof context.worker.programMaintenance.createHandler).toBe('function')
    expect(context.worker.programMaintenance.jobName).toBe('goal-program.maintain')
  })

  it('composes only GoalProgram repositories and use cases for beta', () => {
    const context = build()

    expect(Object.keys(context.publicApi).sort()).toEqual([
      'findMonthlyResultNotificationFacts',
      'findMonthlyResultRevisionNotificationFacts',
      'programs',
    ])
    expect(Object.keys(context.publicApi.programs).sort()).toEqual([
      'changeAssignments',
      'changeStatus',
      'create',
      'get',
      'list',
      'revise',
    ])
    expect(Object.keys(context.internal.repos)).toEqual(['goalProgramRepo'])
    expect(Object.keys(context.internal)).toEqual(['repos'])
  })
})
