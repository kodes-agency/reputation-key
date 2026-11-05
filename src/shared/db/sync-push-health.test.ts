import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { readSyncPushHealth } from './sync-push-health'

async function reconciliationQuery() {
  const where = vi.fn(async (_predicate: SQL | undefined) => [
    { overdue: 1, oldestAgeMs: 36_000_000 },
  ])
  const query = {
    from: () => query,
    innerJoin: () => query,
    leftJoin: () => query,
    where,
  }
  const db = { select: () => query } as unknown as Database
  const health = await readSyncPushHealth(db, false)
  const predicate = where.mock.calls[0]?.[0]
  if (!predicate) throw new Error('Missing reconciliation predicate')
  return { health, ...new PgDialect().sqlToQuery(predicate) }
}

describe('reconciliation age selection', () => {
  it('does not exclude failed properties from the overdue count', async () => {
    const query = await reconciliationQuery()

    expect(query.sql).not.toContain('error_class')
    expect(query.health.reconciliation).toEqual({
      overdueCount: 1,
      oldestAgeMs: 36_000_000,
    })
  })

  it('still requires an active connection, which leaves out reauth_required and provider_revoked', async () => {
    const query = await reconciliationQuery()

    // Revocation is recorded as reauth_required with status_reason provider_revoked.
    expect(query.sql).toContain('"google_connections"."status" =')
    expect(query.sql).toContain('"google_connections"."credential_use_state" =')
  })
})
