import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import type { Redis } from 'ioredis'

const mocks = vi.hoisted(() => {
  const marker = (name: string) => Object.freeze({ name })
  return {
    marker,
    authorization: vi.fn(() => marker('authorization')),
    canaryAuthorization: vi.fn(() => marker('canaryAuthorization')),
    control: vi.fn(() => marker('control')),
    operations: vi.fn(() => marker('operations')),
    outputs: vi.fn(() => marker('outputs')),
    calendar: vi.fn(() => marker('calendar')),
    aggregates: vi.fn(() => marker('aggregates')),
    quota: vi.fn(() => marker('quota')),
    reviewEvents: vi.fn(() => marker('reviewEvents')),
    runtimeCatalogue: vi.fn(() => marker('runtimeCatalogue')),
    propertyProfiles: vi.fn(() => marker('propertyProfiles')),
  }
})

vi.mock('./adapters/ai-authorization.adapter', () => ({
  createAiAuthorizationAdapter: mocks.authorization,
}))
vi.mock('./adapters/ai-canary-authorization.adapter', () => ({
  createAiCanaryAuthorizationAdapter: mocks.canaryAuthorization,
}))
vi.mock('./adapters/ai-control.adapter', () => ({
  createAiControlAdapter: mocks.control,
}))
vi.mock('./adapters/ai-operation-store.adapter', () => ({
  createAiOperationStoreAdapter: mocks.operations,
}))
vi.mock('./adapters/ai-output-store.adapter', () => ({
  createAiOutputStoreAdapter: mocks.outputs,
}))
vi.mock('./adapters/ai-property-calendar.adapter', () => ({
  createAiPropertyCalendarAdapter: mocks.calendar,
}))
vi.mock('./adapters/ai-property-aggregate-store.adapter', () => ({
  createAiPropertyAggregateStoreAdapter: mocks.aggregates,
}))
vi.mock('./adapters/ai-quota.adapter', () => ({
  createRedisAiQuotaAdapter: mocks.quota,
}))
vi.mock('./adapters/ai-review-event-store.adapter', () => ({
  createAiReviewEventStoreAdapter: mocks.reviewEvents,
}))
vi.mock('./adapters/ai-runtime-catalogue.adapter', () => ({
  createAiRuntimeCatalogueAdapter: mocks.runtimeCatalogue,
}))
vi.mock('./adapters/property-processing-profile.adapter', () => ({
  createPropertyProcessingProfileAdapter: mocks.propertyProfiles,
}))

import { createAiDataLifecycle } from './ai-data-lifecycle'

describe('createAiDataLifecycle', () => {
  it('builds one immutable lifecycle from the supplied database and quota Redis', () => {
    const db = { kind: 'database' } as unknown as Database
    const redis = { kind: 'redis' } as unknown as Redis

    const lifecycle = createAiDataLifecycle(db, redis)

    expect(lifecycle).toEqual({
      authorization: { name: 'authorization' },
      canaryAuthorization: { name: 'canaryAuthorization' },
      control: { name: 'control' },
      operations: { name: 'operations' },
      outputs: { name: 'outputs' },
      aggregates: { name: 'aggregates' },
      quota: { name: 'quota' },
      reviewEvents: { name: 'reviewEvents' },
      calendar: { name: 'calendar' },
      runtimeCatalogue: { name: 'runtimeCatalogue' },
      propertyProfiles: { name: 'propertyProfiles' },
    })
    expect(Object.isFrozen(lifecycle)).toBe(true)

    for (const factory of [
      mocks.authorization,
      mocks.canaryAuthorization,
      mocks.control,
      mocks.operations,
      mocks.outputs,
      mocks.calendar,
      mocks.aggregates,
      mocks.reviewEvents,
      mocks.runtimeCatalogue,
    ]) {
      expect(factory).toHaveBeenCalledWith(db)
    }
    expect(mocks.quota).toHaveBeenCalledWith(redis)
    expect(mocks.propertyProfiles).toHaveBeenCalledWith(db, lifecycle.runtimeCatalogue)
  })
})
