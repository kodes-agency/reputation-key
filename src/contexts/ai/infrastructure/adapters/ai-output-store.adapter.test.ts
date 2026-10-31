import { describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { Database } from '#/shared/db'
import { organizationId, propertyId, reviewId, userId } from '#/shared/domain/ids'
import {
  aiOperations,
  aiPropertyProcessingProfiles,
  aiReviewAnalyses,
  aiReviewAnalysisAspects,
  merchantAiEnablement,
  reviews,
} from '#/shared/db/schema'
import { ASPECT_TAXONOMY_V1 } from '#/shared/aspect-taxonomy'
import {
  isExecutionCompatibleWithConsent,
  getAiRuntimeCapability,
} from '#/shared/ai-runtime-capability-contract'
import { createAiOutputStoreAdapter } from './ai-output-store.adapter'

describe('ai output list-filter adapter', () => {
  it('carries the page-bounded reviewIds into the governed SQL predicate', async () => {
    const target = reviewId('00000000-0000-4000-8000-000000000001')
    let predicate: SQL | undefined
    const where = vi.fn(async (condition: SQL) => {
      predicate = condition
      return [{ reviewId: target }]
    })
    const chain: Record<string, unknown> = {}
    chain.from = vi.fn(() => chain)
    chain.innerJoin = vi.fn(() => chain)
    chain.where = where
    const selectDistinct = vi.fn(() => chain)
    const adapter = createAiOutputStoreAdapter({ selectDistinct } as unknown as Database)

    await expect(
      adapter.findCurrentReviewIdsByAttention({
        organizationId: organizationId('org-ai-output-review-scope'),
        reviewIds: [target],
        attention: ['urgent'],
        nowEpochMillis: Date.parse('2026-08-23T12:00:00Z'),
      }),
    ).resolves.toEqual([target])

    expect(predicate).toBeDefined()
    const compiled = new PgDialect().sqlToQuery(predicate!)
    expect(compiled.sql).toContain('"ai_review_analyses"."review_id" in')
    expect(compiled.params).toContain(target)
  })

  it('fails closed without querying when the page-bounded set is empty', async () => {
    const selectDistinct = vi.fn()
    const adapter = createAiOutputStoreAdapter({ selectDistinct } as unknown as Database)

    await expect(
      adapter.findCurrentReviewIdsByAttention({
        organizationId: organizationId('org-ai-output-empty-scope'),
        reviewIds: [],
        attention: ['urgent'],
        nowEpochMillis: Date.parse('2026-08-23T12:00:00Z'),
      }),
    ).resolves.toEqual([])
    expect(selectDistinct).not.toHaveBeenCalled()
  })
})

describe('stored analysis delivery after a notice lapses', () => {
  it('still delivers the existing output under its unchanged grant while refusing new execution', async () => {
    const notice = {
      noticeVersion: 'merchant-ai-notice-2026-10-17.v1',
      noticeDigest: '2bcd2be15cbb81f324f9a9390ad00baff3ffbb25a6c0db8bff71fbb2b1b0975e',
    }
    const input = {
      organizationId: organizationId('stored-analysis-lapsed-notice'),
      propertyId: propertyId('74000000-0000-4000-8000-000000000001'),
      reviewId: reviewId('74000000-0000-4000-8000-000000000002'),
      actorUserId: userId('reader'),
      authorizationLineageId: '74000000-0000-4000-8000-000000000003',
      reviewAnalysisEpoch: 1,
      sourceEpoch: 0,
      sourceRevision: 1,
      analysisSequence: 1,
      propertyProfileVersion: 1,
      analysisProfileVersion: 'review-analysis-v2',
      nowEpochMillis: Date.parse('2026-10-31T12:00:00Z'),
    }
    const authorization = {
      state: 'enabled',
      authorizationLineageId: input.authorizationLineageId,
      capabilities: ['review_analysis'],
      reviewAnalysisEpoch: 1,
      sourceEpoch: 0,
      analysisStartSequence: 0,
      ...notice,
      sourcePolicyId: 'policy',
      redactionProfileFamily: 'redaction',
    }
    const rows = new Map<unknown, readonly unknown[]>([
      [merchantAiEnablement, [authorization]],
      [
        aiPropertyProcessingProfiles,
        [{ lifecycleState: 'active', profileVersion: 1, sourceEpoch: 0 }],
      ],
      [reviews, [{ sourceEpoch: 0, sourceRevision: 1, analysisSequence: 1 }]],
      [
        aiReviewAnalyses,
        [
          {
            status: 'ready',
            sentiment: 'positive',
            primaryCategory: ASPECT_TAXONOMY_V1[0],
            attention: 'low',
            issueLabel: null,
            analysisProfileVersion: 'review-analysis-v2',
            generatedAt: new Date(input.nowEpochMillis - 60_000),
            operationState: 'succeeded',
            operationCommand: 'analysis',
            operationCapability: 'review_analysis',
            operationOrganizationId: input.organizationId,
            operationPropertyId: input.propertyId,
            operationReviewId: input.reviewId,
            operationSourceEpoch: 0,
            operationSourceRevision: 1,
            operationAnalysisSequence: 1,
            operationAuthorizationLineageId: input.authorizationLineageId,
            operationPropertyProfileVersion: 1,
            operationNoticeVersion: notice.noticeVersion,
            operationNoticeDigest: notice.noticeDigest,
            operationSourcePolicyId: 'policy',
            operationRedactionProfileVersion: 'redaction',
            operationCapabilityFences: {
              capability: 'review_analysis',
              reviewAnalysisEpoch: 1,
            },
          },
        ],
      ],
      [
        aiReviewAnalysisAspects,
        [{ aspect: ASPECT_TAXONOMY_V1[0], polarity: 'positive', intensity: 75 }],
      ],
    ])
    const select = () => {
      let result: readonly unknown[] = []
      const chain = {
        from: (table: unknown) => {
          result = rows.get(table) ?? []
          return chain
        },
        innerJoin: (_table: typeof aiOperations, _on: SQL | undefined) => chain,
        where: (_condition: SQL | undefined) => chain,
        limit: (_count: number) => chain,
        for: (_mode: string) => Promise.resolve(result),
        orderBy: (_column: unknown) => Promise.resolve(result),
      }
      return chain
    }
    const adapter = createAiOutputStoreAdapter({
      transaction: async (read: (tx: { select: typeof select }) => Promise<unknown>) =>
        read({ select }),
    } as unknown as Database)
    await expect(
      adapter.readAnalysisForDelivery(input, async (result) => result),
    ).resolves.toMatchObject({ status: 'ready', sentiment: 'positive' })
    expect(
      isExecutionCompatibleWithConsent({
        capability: 'review_analysis',
        acknowledgedNotice: notice,
        servedExecution: getAiRuntimeCapability('review_analysis'),
      }),
    ).toBe(false)
  })
})
