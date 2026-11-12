import type { ClientBase, Pool } from 'pg'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { enrichSpan, runWithContext } from '#/shared/observability/request-context'
import { runInScope } from './scope-store.server'
import {
  bindPoolCheckouts,
  flushScopeObservations,
  getRequestDatabaseTiming,
  observeClient,
  statementShape,
  tenantTableNames,
} from './scope-observation.server'
import { getDatabaseScope, withTenantScope } from './tenant-scope.server'

const warn = vi.hoisted(() => vi.fn())
vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => ({ warn, error: vi.fn() }),
}))

type Query = (...args: unknown[]) => unknown

function fakeClient(answer: Query = async () => ({ rows: [{ n: 1 }] })) {
  const query = vi.fn(answer)
  const client = { query } as unknown as ClientBase
  observeClient(client)
  return { client, query }
}

const tenant = { organizationId: 'org-a', entry: 'session', name: 'getInbox' } as const

beforeEach(() => {
  flushScopeObservations()
  warn.mockReset()
})

describe('tenant tables', () => {
  it('are the schema tables with an organization_id column', () => {
    const tables = tenantTableNames()

    expect(tables.has('reviews')).toBe(true)
    expect(tables.has('properties')).toBe(true)
    expect(tables.has('verification')).toBe(false)
  })

  it('reads tables and Organization parameters out of a statement', () => {
    const shape = statementShape(
      'select "reviews"."id" from "reviews" inner join "properties" on true where "reviews"."organization_id" = $2 and "x" = $1',
    )

    expect(shape.tables).toEqual(['reviews', 'properties'])
    expect(shape.organizationParams).toEqual([1])
    expect(statementShape('begin').boundary).toBe('begin')
    expect(statementShape('rollback').boundary).toBe('end')
    expect(statementShape('rollback to savepoint sp1').boundary).toBeUndefined()
  })
})

describe('observe mode', () => {
  it('names a tenant-table statement with no scope, and still runs it', async () => {
    const { client, query } = fakeClient()

    const result = await runWithContext('request', async () => {
      enrichSpan({ useCase: 'listReviews' })
      return client.query('select * from "reviews"')
    })

    expect(result).toEqual({ rows: [{ n: 1 }] })
    expect(query).toHaveBeenCalledWith('select * from "reviews"')
    expect(flushScopeObservations()).toEqual([
      { reason: 'missing_scope', entry: 'listReviews', table: 'reviews', statements: 1 },
    ])
    expect(warn).toHaveBeenCalledWith(
      {
        reason: 'missing_scope',
        entry: 'listReviews',
        table: 'reviews',
        statements: 1,
        windowMs: 60_000,
      },
      'database scope observe: row security would refuse',
    )
  })

  it('names a statement for another Organization without logging either identifier', async () => {
    const { client } = fakeClient()

    await withTenantScope(tenant, async () => {
      await client.query('select 1 from "reviews" where "organization_id" = $1', [
        'org-b',
      ])
      await client.query('select 1 from "reviews" where "organization_id" = $1', [
        'org-a',
      ])
      await client.query('select 1 from "reviews" where "organization_id" = $1', [
        'org-b',
      ])
    })

    const observed = flushScopeObservations()
    expect(observed).toEqual([
      {
        reason: 'other_organization',
        entry: 'getInbox',
        table: 'reviews',
        statements: 2,
      },
    ])
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/org-[ab]/)
  })

  it('lets system scope and tables without an Organization pass', async () => {
    const { client } = fakeClient()

    await runInScope({ kind: 'system', name: 'job:sweep' }, () =>
      client.query('delete from "reviews"'),
    )
    await client.query('select * from "verification"')

    expect(flushScopeObservations()).toEqual([])
  })

  it('keeps a callback query and its error unchanged', async () => {
    const failure = new Error('boom')
    const { client } = fakeClient((_text, _values, callback) => {
      ;(callback as (error: Error) => void)(failure)
      return undefined
    })

    const error = await new Promise((resolve) => {
      client.query('select 1 from "reviews"', [], (err: Error) => resolve(err))
    })

    expect(error).toBe(failure)
  })

  it('keeps a rejected query rejected', async () => {
    const failure = new Error('boom')
    const { client } = fakeClient(() => Promise.reject(failure))

    await expect(client.query('select 1')).rejects.toBe(failure)
  })
})

describe('request timing', () => {
  it('counts statements, autocommit statements and transactions per request', async () => {
    const { client } = fakeClient()

    const timing = await runWithContext('request', async () => {
      await client.query('select 1')
      await client.query('begin')
      await client.query('select 2')
      await client.query('commit')
      return getRequestDatabaseTiming()
    })

    expect(timing).toMatchObject({
      statements: 2,
      autocommitStatements: 1,
      transactions: 1,
    })
    expect(timing!.transactionMs).toBeGreaterThanOrEqual(0)
    expect(
      await runWithContext('next', async () => getRequestDatabaseTiming()),
    ).toBeUndefined()
  })
})

describe('pool checkouts', () => {
  it('run a queued checkout callback in the scope that asked for it', async () => {
    let release: (() => void) | undefined
    const pool = {
      connect: (callback: () => void) => {
        release = callback
      },
    } as unknown as Pool
    bindPoolCheckouts(pool)

    const seen = withTenantScope(
      tenant,
      () => new Promise((resolve) => pool.connect(() => resolve(getDatabaseScope()))),
    )
    // Another request releases the client that answers the queued checkout.
    release?.()

    expect(await seen).toEqual({ kind: 'tenant', ...tenant })
  })
})
