import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { runWithContext } from '#/shared/observability/request-context'
import { getDb } from './index'
import { withExecutionDeadline } from './execution-deadline.server'
import {
  resetScopeProcessForTest,
  runInScope,
  SystemScopeRefusedError,
} from './scope-store.server'
import {
  declareRequestProcess,
  enterTenantScope,
  getDatabaseScope,
  withTenantScope,
} from './tenant-scope.server'

const query = vi.hoisted(() =>
  vi.fn<(query: { text: string }, params: unknown[]) => Promise<{ rows: unknown[] }>>(),
)

vi.mock('./pool', () => ({ getPool: () => ({ query }) }))

const statements = () =>
  query.mock.calls.map(([statement, params]) => [statement.text, params])

beforeEach(() => query.mockReset().mockResolvedValue({ rows: [] }))
afterEach(() => resetScopeProcessForTest())

const tenant = { organizationId: 'org-a', entry: 'session', name: 'getInbox' } as const

describe('tenant scope', () => {
  it('holds only for the work run inside it', async () => {
    const inside = await withTenantScope(tenant, async () => getDatabaseScope())

    expect(inside).toEqual({ kind: 'tenant', ...tenant })
    expect(getDatabaseScope()).toBeUndefined()
  })

  it('keeps a scope entered at auth for the rest of that request only', async () => {
    const resolved = await runWithContext('request-a', async () => {
      enterTenantScope(tenant)
      await Promise.resolve()
      return getDatabaseScope()
    })
    const next = await runWithContext('request-b', async () => getDatabaseScope())

    expect(resolved).toEqual({ kind: 'tenant', ...tenant })
    expect(next).toBeUndefined()
  })

  it('ignores an empty Organization', async () => {
    const scope = await runWithContext('request', async () => {
      enterTenantScope({ ...tenant, organizationId: '' })
      return getDatabaseScope()
    })

    expect(scope).toBeUndefined()
  })
})

describe('system scope', () => {
  it('runs named work outside a request process', async () => {
    expect(
      await runInScope({ kind: 'system', name: 'job:sweep' }, async () =>
        getDatabaseScope(),
      ),
    ).toEqual({
      kind: 'system',
      name: 'job:sweep',
    })
  })

  it('is refused once the process serves requests, before any work runs', () => {
    declareRequestProcess()
    const work = vi.fn()

    expect(() => runInScope({ kind: 'system', name: 'job:sweep' }, work)).toThrow(
      SystemScopeRefusedError,
    )
    expect(work).not.toHaveBeenCalled()
  })

  it('leaves tenant scope available to a request process', async () => {
    declareRequestProcess()

    expect(await withTenantScope(tenant, async () => getDatabaseScope())).toMatchObject({
      kind: 'tenant',
    })
  })
})

describe('transactions under a scope', () => {
  it('sets the tenant locally before the work', async () => {
    await withTenantScope(tenant, () =>
      getDb().transaction(async (tx) => {
        await tx.execute(sql`select 1`)
      }),
    )

    expect(statements()).toEqual([
      ['begin', []],
      [
        "select set_config('app.scope', $1, true), set_config('app.organization_id', $2, true)",
        ['tenant', 'org-a'],
      ],
      ['select 1', []],
      ['commit', []],
    ])
  })

  it('marks system work with no Organization', async () => {
    await runInScope({ kind: 'system', name: 'job:sweep' }, () =>
      getDb().transaction(async () => undefined),
    )

    expect(statements()[1]).toEqual([
      "select set_config('app.scope', $1, true), set_config('app.organization_id', $2, true)",
      ['system', ''],
    ])
  })

  it('shares one statement with the job deadline', async () => {
    const deadline = {
      signal: new AbortController().signal,
      expiresAt: Date.now() + 60_000,
    }

    await withExecutionDeadline(deadline, () =>
      withTenantScope({ ...tenant, entry: 'job' }, () =>
        getDb().transaction(async () => undefined),
      ),
    )

    expect(statements()[1]?.[0]).toBe(
      "select set_config('statement_timeout', $1, true), set_config('app.scope', $2, true), set_config('app.organization_id', $3, true)",
    )
  })

  it('sends nothing extra without a scope', async () => {
    await getDb().transaction(async (tx) => {
      await tx.execute(sql`select 1`)
    })

    expect(statements()).toEqual([
      ['begin', []],
      ['select 1', []],
      ['commit', []],
    ])
  })
})
