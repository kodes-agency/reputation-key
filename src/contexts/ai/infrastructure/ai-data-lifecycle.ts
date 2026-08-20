import type { Database } from '#/shared/db'
import type { Redis } from 'ioredis'
import { createAiAuthorizationAdapter } from './adapters/ai-authorization.adapter'
import { createAiCanaryAuthorizationAdapter } from './adapters/ai-canary-authorization.adapter'
import { createAiControlAdapter } from './adapters/ai-control.adapter'
import { createAiOperationStoreAdapter } from './adapters/ai-operation-store.adapter'
import { createAiOutputStoreAdapter } from './adapters/ai-output-store.adapter'
import { createAiPropertyCalendarAdapter } from './adapters/ai-property-calendar.adapter'
import { createAiPropertyAggregateStoreAdapter } from './adapters/ai-property-aggregate-store.adapter'
import { createRedisAiQuotaAdapter } from './adapters/ai-quota.adapter'
import { createAiReviewEventStoreAdapter } from './adapters/ai-review-event-store.adapter'
import { createAiRuntimeCatalogueAdapter } from './adapters/ai-runtime-catalogue.adapter'
import { createPropertyProcessingProfileAdapter } from './adapters/property-processing-profile.adapter'

export function createAiDataLifecycle(db: Database, redis: Redis) {
  const runtimeCatalogue = createAiRuntimeCatalogueAdapter(db)
  const calendar = createAiPropertyCalendarAdapter(db)
  return Object.freeze({
    authorization: createAiAuthorizationAdapter(db),
    canaryAuthorization: createAiCanaryAuthorizationAdapter(db),
    control: createAiControlAdapter(db),
    operations: createAiOperationStoreAdapter(db),
    outputs: createAiOutputStoreAdapter(db),
    aggregates: createAiPropertyAggregateStoreAdapter(db),
    quota: createRedisAiQuotaAdapter(redis),
    reviewEvents: createAiReviewEventStoreAdapter(db),
    calendar,
    runtimeCatalogue,
    propertyProfiles: createPropertyProcessingProfileAdapter(db, runtimeCatalogue),
  })
}
