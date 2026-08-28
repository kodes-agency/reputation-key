import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { aiAuthorizationLifecycleRecords } from './ai.schema'

describe('AI authorization lifecycle schema', () => {
  it('models claim recovery, bounded retries, and content-free completion counts', () => {
    const table = getTableConfig(aiAuthorizationLifecycleRecords)
    expect(table.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'erasure_attempt_count',
        'erasure_next_attempt_at',
        'erasure_claimed_at',
        'erasure_lease_owner',
        'erasure_lease_expires_at',
        'erasure_last_failure_at',
        'erased_review_analysis_count',
        'erased_property_aggregate_count',
        'erased_property_trend_count',
      ]),
    )
    expect(table.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        'ai_authorization_lifecycle_erasure_due_idx',
        'ai_authorization_lifecycle_erasure_lease_idx',
      ]),
    )
  })
})
