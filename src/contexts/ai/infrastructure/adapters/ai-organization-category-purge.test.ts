import { describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { Database } from '#/shared/db'
import { createAiOrganizationLifecycleContributor } from './ai-organization-lifecycle.adapter'

vi.mock(
  '#/shared/db/lifecycle/organization-lifecycle-receipt-store',
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import('#/shared/db/lifecycle/organization-lifecycle-receipt-store')
      >()
    return {
      ...original,
      createOrganizationLifecycleContributorScaffold: (
        deps: Parameters<
          typeof original.createOrganizationLifecycleContributorScaffold
        >[0],
      ) => ({
        context: deps.context,
        purge: (request: Parameters<typeof deps.purge>[1]) =>
          deps.db.transaction((tx) => deps.purge(tx, request)),
      }),
    }
  },
)

describe('Organization AI category purge', () => {
  it('clears only the purged Organization’s category hints alongside its AI derivatives', async () => {
    const queries: { sql: string; params: unknown[] }[] = []
    const tx = {
      execute: async (statement: SQL) => {
        const query = new PgDialect().sqlToQuery(statement)
        queries.push(query)
        return { rows: query.sql.includes('AS footprint') ? [{ footprint: 1 }] : [] }
      },
    }
    const db = {
      transaction: async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx),
    } as unknown as Database
    const contributor = createAiOrganizationLifecycleContributor(db)
    await contributor.purge({
      organizationId: 'category-purge-org',
      closureLineageId: '10000000-0000-4000-8000-000000000001',
      lifecycleRevision: 4,
      recoverableUntil: new Date('2026-11-05T10:00:00Z'),
      occurredAt: new Date('2026-11-06T10:00:00Z'),
    })
    const clear = queries.find((query) =>
      /UPDATE properties\s+SET google_primary_category\s*=\s*NULL/i.test(query.sql),
    )
    expect(clear).toBeDefined()
    expect(clear?.sql).toMatch(/google_primary_category_updated_at\s*=\s*NULL/i)
    expect(clear?.sql).toMatch(/WHERE organization_id\s*=/i)
    expect(clear?.params).toEqual(['category-purge-org'])
    expect(
      queries.some((query) => query.sql.includes('DELETE FROM "ai_review_analyses"')),
    ).toBe(true)
  })
})
