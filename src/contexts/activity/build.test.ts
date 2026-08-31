import { describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { recentActivityEntryId } from '#/shared/domain/ids'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { operationalActionHistoryRecordId } from './domain/operational-action-history'
import { buildActivityContext } from './build'

describe('buildActivityContext', () => {
  it('returns the standard publicApi/worker/internal boundary', () => {
    const context = buildActivityContext({
      db: {} as Database,
      events: {} as EventBus,
      staffPublicApi: {} as StaffPublicApi,
      queue: undefined,
      clock: () => new Date('2026-08-28T00:00:00.000Z'),
      logger: createMockLogger(),
      idGen: () => recentActivityEntryId('00000000-0000-4000-8000-000000000999'),
      operationalHistoryIdGen: () =>
        operationalActionHistoryRecordId('00000000-0000-4000-8000-000000000998'),
      operationalHistoryHoldIdGen: () => '00000000-0000-4000-8000-000000000997',
    })

    expect(Object.keys(context).sort()).toEqual([
      'internal',
      'organizationExportContributor',
      'organizationLifecycleContributor',
      'publicApi',
      'worker',
    ])
    // LIF-01-T8: the export contributor is a named lifecycle seam, never a
    // publicApi key — wiring it must not widen the manager-facing surface.
    expect(context.organizationExportContributor.context).toBe('activity')
    expect(context.publicApi).not.toHaveProperty('organizationExportContributor')
    // LIF-01-T12/T13/T14: same rule for the lifecycle contributor. It answers
    // all three phases and stays off the manager-facing surface, so composing
    // Activity cannot make purge reachable from a product route.
    expect(context.organizationLifecycleContributor.context).toBe('activity')
    expect(context.organizationLifecycleContributor.prepareClosing).toBeTypeOf('function')
    expect(context.organizationLifecycleContributor.verifyPurgeReadiness).toBeTypeOf(
      'function',
    )
    expect(context.organizationLifecycleContributor.purge).toBeTypeOf('function')
    expect(context.publicApi).not.toHaveProperty('organizationLifecycleContributor')
    // ARC-03-T12: Activity owns the Recent Activity projection; the container
    // no longer publishes its repository for the worker to assemble one.
    expect(Object.keys(context.worker).sort()).toEqual([
      'projectRecentActivity',
      'registerOutboxConsumers',
    ])
    expect(context.worker.registerOutboxConsumers).toBeTypeOf('function')
    expect(Object.keys(context.internal).sort()).toEqual(['repos', 'useCases'])
    expect(context.internal.useCases).toMatchObject({
      getActivityTimeline: context.publicApi.getActivityTimeline,
      listRecentActivity: context.publicApi.listRecentActivity,
      listOperationalActionHistory: context.publicApi.listOperationalActionHistory,
      exportOperationalActionHistory: context.publicApi.exportOperationalActionHistory,
    })
    expect(context.internal.useCases.recoverRecentActivity).toBeTypeOf('function')
    expect(context.internal.useCases.getRecentActivityReadiness).toBeTypeOf('function')
    expect(context.internal.useCases.appendOperationalAction).toBeTypeOf('function')
    expect(context.internal.useCases.getOperationalActionHistoryReadiness).toBeTypeOf(
      'function',
    )
    expect(context.internal.useCases.assessOperationalActionHistoryRetention).toBeTypeOf(
      'function',
    )
    expect(context.internal.useCases.placeOperationalActionHistoryLegalHold).toBeTypeOf(
      'function',
    )
    expect(context.internal.useCases.releaseOperationalActionHistoryLegalHold).toBeTypeOf(
      'function',
    )
    expect(context.internal.useCases.redactOperationalActionHistorySubject).toBeTypeOf(
      'function',
    )
  })
})
