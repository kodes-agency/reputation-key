import { describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { Database } from '#/shared/db'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { AiAuthorizationLifecycleTrigger } from '../../replay/contracts'
import { createReviewAnalysisEnrollmentAdapter } from '../../replay/enrollment-store.server'

vi.mock('../../replay/consent-refresh.server', () => ({
  preserveAnalysisEnrollment: async () => 'preserved-enrollment',
}))

const ORG = organizationId('category-purge-org')
const PROPERTY = propertyId('10000000-0000-4000-8000-000000000001')
const LINEAGE = '10000000-0000-4000-8000-000000000002'
const input = (
  state: AiAuthorizationLifecycleTrigger['authorizationState'],
): AiAuthorizationLifecycleTrigger => ({
  organizationId: ORG,
  propertyId: PROPERTY,
  eventEnvelopeId: '10000000-0000-4000-8000-000000000003',
  authorizationState: state,
  correlationId: null,
  occurredAt: new Date('2026-11-06T10:00:00Z'),
  fence: {
    authorizationLineageId: LINEAGE,
    authorizationStateVersion: 2,
    sourceEpoch: 1,
    reviewAnalysisEpoch: 2,
    replyDraftingEpoch: 1,
    propertyTrendsEpoch: 1,
    analysisStartSequence: 0,
  },
})

function harness(
  state: AiAuthorizationLifecycleTrigger['authorizationState'],
  capabilities: string[],
  obsolete = false,
) {
  const queries: { sql: string; params: unknown[] }[] = []
  const dialect = new PgDialect()
  const tx = {
    execute: async (statement: SQL) => {
      const query = dialect.sqlToQuery(statement)
      queries.push(query)
      return {
        rows: query.sql.includes('SELECT enablement.*')
          ? [
              {
                authorization_lineage_id: LINEAGE,
                state,
                state_version: obsolete ? 3 : 2,
                authorized_source_epoch: 1,
                review_analysis_epoch: 2,
                reply_drafting_epoch: 1,
                property_trends_epoch: 1,
                analysis_start_sequence: 0,
                deleted_at: null,
                lifecycle_state: 'active',
                property_source_epoch: 1,
                capabilities,
              },
            ]
          : [],
      }
    },
    insert: () => ({ values: () => ({ onConflictDoNothing: async () => undefined }) }),
  }
  const db = {
    transaction: async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx),
  } as unknown as Database
  return {
    adapter: createReviewAnalysisEnrollmentAdapter(db, () => 'enrollment'),
    queries,
  }
}

describe('category retention during AI authorization lifecycle', () => {
  it.each(['disabled', 'revoked'] as const)(
    'clears the category in the %s analysis purge transaction',
    async (state) => {
      const { adapter, queries } = harness(state, [])
      await adapter.applyAuthorizationLifecycle(input(state))
      const clear = queries.find((query) =>
        /UPDATE properties\s+SET google_primary_category\s*=\s*NULL/i.test(query.sql),
      )
      expect(clear).toBeDefined()
      expect(clear?.sql).toMatch(/google_primary_category_updated_at\s*=\s*NULL/i)
      expect(clear?.sql).toMatch(/WHERE\s+organization_id\s*=/i)
      expect(clear?.sql).toMatch(/AND id\s*=/i)
      expect(clear?.params).toEqual([ORG, PROPERTY])
      expect(
        queries.some((query) => query.sql.includes('DELETE FROM ai_review_analyses')),
      ).toBe(true)
    },
  )

  it('clears the category when review analysis is removed while drafting stays enabled', async () => {
    const { adapter, queries } = harness('enabled', ['reply_drafting'])
    await adapter.applyAuthorizationLifecycle(input('enabled'))
    expect(
      queries.some((query) =>
        /UPDATE properties\s+SET google_primary_category\s*=\s*NULL/i.test(query.sql),
      ),
    ).toBe(true)
  })

  it('preserves the category when enabled review analysis moves to a new epoch', async () => {
    const { adapter, queries } = harness('enabled', ['review_analysis'])
    await adapter.applyAuthorizationLifecycle(input('enabled'))
    expect(
      queries.some((query) => query.sql.includes('DELETE FROM ai_review_analyses')),
    ).toBe(true)
    expect(queries.some((query) => /UPDATE properties/i.test(query.sql))).toBe(false)
  })

  it('does not clear a category for an obsolete authorization event', async () => {
    const { adapter, queries } = harness('disabled', [], true)
    expect(await adapter.applyAuthorizationLifecycle(input('disabled'))).toMatchObject({
      status: 'obsolete',
    })
    expect(queries.some((query) => /UPDATE properties/i.test(query.sql))).toBe(false)
  })
})
