import type { QueryResult } from 'pg'
import { describe, expect, it } from 'vitest'
import {
  buildConcurrentIndex,
  ConcurrentIndexSidecarError,
  type SqlClient,
} from './concurrent-index-sidecar'
import type { ConcurrentIndexSpec } from './concurrent-index-registry'

const SPEC: ConcurrentIndexSpec = Object.freeze({
  name: 'widgets_scope_idx',
  table: 'widgets',
  columns: ['organization_id', 'widget_id'],
  unique: false,
  hasPredicate: true,
  createSql: 'CREATE INDEX CONCURRENTLY "widgets_scope_idx" ON "widgets" (...)',
})

type IndexRow = Readonly<{
  indisvalid: boolean
  indisready: boolean
  indisunique: boolean
  key_columns: readonly string[]
  has_predicate: boolean
}>

const MATCHING_ROW: IndexRow = Object.freeze({
  indisvalid: true,
  indisready: true,
  indisunique: false,
  key_columns: SPEC.columns,
  has_predicate: true,
})

/**
 * A fake `SqlClient` scripted by query-text substring, mirroring
 * `test-db-setup.test.ts`'s `lockClient` pattern. `state.indexRow` is what
 * the next inspect query answers; `CREATE`/`DROP` mutate it in place so a
 * test can observe the "before" and "after" of a real build sequence instead
 * of asserting against two disconnected fakes.
 */
function fakeClient(options: {
  events: string[]
  acquired?: boolean
  indexRow?: IndexRow | null
  /** Row the inspect query returns after a successful CREATE. */
  createResultRow?: IndexRow
  failOn?: 'inspect' | 'lock' | 'drop' | 'create'
}): SqlClient {
  const state: { indexRow: IndexRow | null } = { indexRow: options.indexRow ?? null }
  return {
    async query<TRow extends Record<string, unknown>>(
      text: string,
    ): Promise<QueryResult<TRow>> {
      const result = (rows: unknown[]): QueryResult<TRow> =>
        ({
          command: 'SELECT',
          rowCount: rows.length,
          oid: 0,
          fields: [],
          rows,
        }) as QueryResult<TRow>

      if (text.includes('pg_try_advisory_lock')) {
        options.events.push('lock')
        if (options.failOn === 'lock') throw new Error('lock failed')
        return result([{ acquired: options.acquired ?? true }])
      }
      if (text.includes('pg_advisory_unlock')) {
        options.events.push('unlock')
        return result([{ released: true }])
      }
      if (text.includes('FROM pg_index')) {
        options.events.push('inspect')
        if (options.failOn === 'inspect') throw new Error('inspect failed')
        return result(state.indexRow ? [state.indexRow] : [])
      }
      if (text.includes('DROP INDEX CONCURRENTLY')) {
        options.events.push('drop')
        if (options.failOn === 'drop') throw new Error('drop failed')
        state.indexRow = null
        return result([])
      }
      if (text.includes('CREATE INDEX CONCURRENTLY')) {
        options.events.push('create')
        if (options.failOn === 'create') throw new Error('create failed')
        state.indexRow = options.createResultRow ?? MATCHING_ROW
        return result([])
      }
      throw new Error(`unscripted query: ${text}`)
    },
  }
}

describe('buildConcurrentIndex', () => {
  it('does nothing when a matching, valid index already exists', async () => {
    const events: string[] = []
    const client = fakeClient({ events, indexRow: MATCHING_ROW })

    await expect(buildConcurrentIndex(client, SPEC)).resolves.toEqual({
      name: SPEC.name,
      ok: true,
      code: 'ready',
    })
    expect(events).toEqual(['lock', 'inspect', 'unlock'])
  })

  it('creates the index when none exists yet', async () => {
    const events: string[] = []
    const client = fakeClient({ events, indexRow: null })

    await expect(buildConcurrentIndex(client, SPEC)).resolves.toEqual({
      name: SPEC.name,
      ok: true,
      code: 'created',
    })
    expect(events).toEqual(['lock', 'inspect', 'create', 'inspect', 'unlock'])
  })

  it('reports advisory_lock_busy and touches nothing else when the lock is held elsewhere', async () => {
    const events: string[] = []
    const client = fakeClient({ events, acquired: false, indexRow: null })

    await expect(buildConcurrentIndex(client, SPEC)).resolves.toEqual({
      name: SPEC.name,
      ok: false,
      code: 'advisory_lock_busy',
    })
    // No unlock: a lock this run never acquired is not this run's to release.
    expect(events).toEqual(['lock'])
  })

  it('drops and rebuilds an index left invalid by a crashed prior build', async () => {
    const events: string[] = []
    const invalidRow: IndexRow = { ...MATCHING_ROW, indisvalid: false }
    const client = fakeClient({ events, indexRow: invalidRow })

    await expect(buildConcurrentIndex(client, SPEC)).resolves.toEqual({
      name: SPEC.name,
      ok: true,
      code: 'recreated',
    })
    expect(events).toEqual(['lock', 'inspect', 'drop', 'create', 'inspect', 'unlock'])
  })

  it('reports index_invalid when the index still does not match after a build', async () => {
    const events: string[] = []
    const stillMismatched: IndexRow = { ...MATCHING_ROW, key_columns: ['wrong_column'] }
    const client = fakeClient({
      events,
      indexRow: null,
      createResultRow: stillMismatched,
    })

    await expect(buildConcurrentIndex(client, SPEC)).resolves.toEqual({
      name: SPEC.name,
      ok: false,
      code: 'index_invalid',
    })
    expect(events).toEqual(['lock', 'inspect', 'create', 'inspect', 'unlock'])
  })

  it('throws ConcurrentIndexSidecarError with a safe code when the catalog inspection query fails', async () => {
    const events: string[] = []
    const client = fakeClient({ events, indexRow: null, failOn: 'inspect' })

    const error = await buildConcurrentIndex(client, SPEC).catch(
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(ConcurrentIndexSidecarError)
    expect((error as ConcurrentIndexSidecarError).safeCode).toBe(
      'index_inspection_failed',
    )
  })

  it('releases the advisory lock even when the CONCURRENTLY build itself fails', async () => {
    const events: string[] = []
    const client = fakeClient({ events, indexRow: null, failOn: 'create' })

    const error = await buildConcurrentIndex(client, SPEC).catch(
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(ConcurrentIndexSidecarError)
    expect((error as ConcurrentIndexSidecarError).safeCode).toBe('index_build_failed')
    expect(events).toEqual(['lock', 'inspect', 'create', 'unlock'])
  })
})
