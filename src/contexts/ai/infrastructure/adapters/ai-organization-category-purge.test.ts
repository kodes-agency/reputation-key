import { describe, expect, it } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { Tx } from '#/shared/outbox/commit'
import { eraseAiOrganizationRows } from './ai-organization-erasure'

describe('Organization AI category purge', () => {
  it('clears only the purged Organization’s category hints alongside its AI derivatives', async () => {
    const queries: { sql: string; params: unknown[] }[] = []
    const tx = {
      execute: async (statement: SQL) => {
        const query = new PgDialect().sqlToQuery(statement)
        queries.push(query)
        return { rows: [] }
      },
    } as unknown as Tx

    await eraseAiOrganizationRows(tx, 'category-purge-org')

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
