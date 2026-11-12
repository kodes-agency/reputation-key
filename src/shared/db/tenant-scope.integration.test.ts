// The application pool with one client, so every statement below reuses the
// same physical connection. A transaction under a scope sets the tenant
// locally; the next user of that client must see none of it.

import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runWithContext } from '#/shared/observability/request-context'
import { getDb } from './index'
import { closePool, configurePoolMaxConnections, getPool } from './pool'
import { flushScopeObservations } from './scope-observation.server'
import {
  resetScopeProcessForTest,
  runInScope,
  SystemScopeRefusedError,
} from './scope-store.server'
import { declareRequestProcess, withTenantScope } from './tenant-scope.server'

const ORG_A = 'org-tenant-scope-a'
const ORG_B = 'org-tenant-scope-b'

type Settings = { scope: string | null; organization: string | null; backend: number }

async function settings(): Promise<Settings> {
  const result = await getPool().query<Settings>(
    `SELECT current_setting('app.scope', true) AS scope,
            current_setting('app.organization_id', true) AS organization,
            pg_backend_pid() AS backend`,
  )
  return result.rows[0]!
}

async function settingsInTransaction(): Promise<Settings> {
  return getDb().transaction(async (tx) => {
    const result = await tx.execute<Settings>(
      sql`SELECT current_setting('app.scope', true) AS scope,
                 current_setting('app.organization_id', true) AS organization,
                 pg_backend_pid() AS backend`,
    )
    return result.rows[0]!
  })
}

beforeAll(() => {
  configurePoolMaxConnections(1)
  flushScopeObservations()
})

afterAll(async () => {
  resetScopeProcessForTest()
  await closePool()
})

describe.sequential('database scope on a pooled connection (PostgreSQL)', () => {
  it('sets the tenant inside the transaction and clears it for the next user of the client', async () => {
    const before = await settings()

    const inside = await withTenantScope(
      { organizationId: ORG_A, entry: 'session', name: 'scope-test' },
      settingsInTransaction,
    )
    const after = await settings()
    const unscoped = await settingsInTransaction()

    expect(inside).toMatchObject({ scope: 'tenant', organization: ORG_A })
    expect(after.backend).toBe(before.backend)
    expect(after.backend).toBe(inside.backend)
    expect(after.organization || null).toBeNull()
    expect(after.scope || null).toBeNull()
    expect(unscoped.organization || null).toBeNull()
  })

  it('clears the tenant after a rolled-back transaction too', async () => {
    await expect(
      withTenantScope({ organizationId: ORG_B, entry: 'job', name: 'scope-test' }, () =>
        getDb().transaction(async (tx) => {
          await tx.execute(sql`SELECT 1`)
          throw new Error('roll back')
        }),
      ),
    ).rejects.toThrow('roll back')

    const after = await settings()
    expect(after.organization || null).toBeNull()
  })

  it('names the tables a policy would refuse without changing any result', async () => {
    flushScopeObservations()

    const unscoped = await runWithContext('scope-test', async () =>
      getPool().query<{ n: number }>('SELECT count(*)::int AS n FROM "reviews"'),
    )
    const foreign = await withTenantScope(
      { organizationId: ORG_A, entry: 'session', name: 'scope-test' },
      () =>
        getPool().query<{ n: number }>(
          'SELECT count(*)::int AS n FROM "reviews" WHERE "organization_id" = $1',
          [ORG_B],
        ),
    )
    const own = await withTenantScope(
      { organizationId: ORG_A, entry: 'session', name: 'scope-test' },
      () =>
        getPool().query<{ n: number }>(
          'SELECT count(*)::int AS n FROM "reviews" WHERE "organization_id" = $1',
          [ORG_A],
        ),
    )
    const system = await runInScope({ kind: 'system', name: 'job:scope-test' }, () =>
      getPool().query<{ n: number }>('SELECT count(*)::int AS n FROM "reviews"'),
    )

    // Other suites share this database, so the table need not be empty: the
    // unscoped read must see every row the system read sees, and the organisations
    // here own no rows at all.
    expect(unscoped.rows).toEqual(system.rows)
    expect(foreign.rows).toEqual([{ n: 0 }])
    expect(own.rows).toEqual([{ n: 0 }])
    expect(flushScopeObservations()).toEqual([
      { reason: 'missing_scope', entry: 'unattributed', table: 'reviews', statements: 1 },
      {
        reason: 'other_organization',
        entry: 'scope-test',
        table: 'reviews',
        statements: 1,
      },
    ])
  })

  it('refuses system scope once the process serves requests', async () => {
    declareRequestProcess()

    expect(() =>
      runInScope({ kind: 'system', name: 'job:scope-test' }, settingsInTransaction),
    ).toThrow(SystemScopeRefusedError)
    expect((await settings()).organization || null).toBeNull()
  })
})
