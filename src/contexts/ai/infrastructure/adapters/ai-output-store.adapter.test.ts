import { describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { Database } from '#/shared/db'
import { organizationId, reviewId } from '#/shared/domain/ids'
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
