import type { QueryResult } from 'pg'
import { describe, expect, it } from 'vitest'
import {
  buildConcurrentIndex,
  ConcurrentIndexMigrationError,
  type SqlClient,
} from './concurrent-index-migration'
import type { ConcurrentIndexSpec } from './concurrent-index-registry'

const SPEC: ConcurrentIndexSpec = Object.freeze({
  name: 'widgets_scope_idx',
  table: 'widgets',
  columns: ['organization_id', 'widget_id'],
  unique: false,
  hasPredicate: true,
  createSql:
    'CREATE INDEX CONCURRENTLY "widgets_scope_idx" ON "widgets" ("organization_id", "widget_id") WHERE "active" IS TRUE',
})

type IndexRow = Readonly<{
  indisvalid: boolean
  indisready: boolean
  indisunique: boolean
  key_columns: readonly string[]
  has_predicate: boolean
  predicate: string | null
}>

const MATCHING_ROW: IndexRow = Object.freeze({
  indisvalid: true,
  indisready: true,
  indisunique: false,
  key_columns: SPEC.columns,
  has_predicate: true,
  predicate: '(active IS TRUE)',
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
  failOn?: 'inspect' | 'lock' | 'drop' | 'create' | 'predicate'
}): SqlClient {
  const state: { indexRow: IndexRow | null } = { indexRow: options.indexRow ?? null }

  function recordQuery(operation: 'lock' | 'inspect' | 'drop' | 'create'): void {
    options.events.push(operation)
    if (options.failOn === operation) throw new Error(`${operation} failed`)
  }

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
        recordQuery('lock')
        return result([{ acquired: options.acquired ?? true }])
      }
      if (text.includes('pg_advisory_unlock')) {
        options.events.push('unlock')
        return result([{ released: true }])
      }
      if (text.includes('AS expected_predicate')) {
        if (options.failOn === 'predicate') throw new Error('predicate lookup failed')
        return result([{ expected_predicate: MATCHING_ROW.predicate }])
      }
      if (
        text.startsWith('CREATE TEMP TABLE') ||
        text.startsWith('CREATE INDEX ON pg_temp.') ||
        text.startsWith('DROP TABLE pg_temp.')
      ) {
        return result([])
      }
      if (text.includes('FROM pg_index')) {
        recordQuery('inspect')
        return result(state.indexRow ? [state.indexRow] : [])
      }
      if (text.includes('DROP INDEX CONCURRENTLY')) {
        recordQuery('drop')
        state.indexRow = null
        return result([])
      }
      if (/^CREATE (?:UNIQUE )?INDEX CONCURRENTLY/.test(text)) {
        recordQuery('create')
        state.indexRow = options.createResultRow ?? MATCHING_ROW
        return result([])
      }
      throw new Error(`unscripted query: ${text}`)
    },
  }
}

describe('buildConcurrentIndex', () => {
  it.each([false, true])(
    'rebuilds a completed partial index with the wrong predicate (unique=%s)',
    async (unique) => {
      const events: string[] = []
      const spec = {
        ...SPEC,
        unique,
        createSql: unique
          ? SPEC.createSql.replace('CREATE INDEX', 'CREATE UNIQUE INDEX')
          : SPEC.createSql,
      }
      const matchingRow = { ...MATCHING_ROW, indisunique: unique }
      const client = fakeClient({
        events,
        indexRow: { ...matchingRow, predicate: '(active IS FALSE)' },
        createResultRow: matchingRow,
      })

      await expect(buildConcurrentIndex(client, spec)).resolves.toEqual({
        name: SPEC.name,
        ok: true,
        code: 'recreated',
      })
      expect(events).toEqual(['lock', 'inspect', 'drop', 'create', 'inspect', 'unlock'])
    },
  )

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

  it('preserves the existing index and releases its lock if predicate verification fails', async () => {
    const events: string[] = []
    const client = fakeClient({ events, indexRow: MATCHING_ROW, failOn: 'predicate' })

    await expect(buildConcurrentIndex(client, SPEC)).rejects.toMatchObject({
      safeCode: 'index_definition_failed',
    })
    expect(events).toEqual(['lock', 'inspect', 'unlock'])
  })

  it('refuses a build whose recorded predicate still differs from the requested predicate', async () => {
    const events: string[] = []
    const client = fakeClient({
      events,
      createResultRow: { ...MATCHING_ROW, predicate: '(active IS FALSE)' },
    })

    await expect(buildConcurrentIndex(client, SPEC)).resolves.toMatchObject({
      ok: false,
      code: 'index_invalid',
    })
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

  it('throws ConcurrentIndexMigrationError with a safe code when the catalog inspection query fails', async () => {
    const events: string[] = []
    const client = fakeClient({ events, indexRow: null, failOn: 'inspect' })

    const error = await buildConcurrentIndex(client, SPEC).catch(
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(ConcurrentIndexMigrationError)
    expect((error as ConcurrentIndexMigrationError).safeCode).toBe(
      'index_inspection_failed',
    )
  })

  it('releases the advisory lock even when the CONCURRENTLY build itself fails', async () => {
    const events: string[] = []
    const client = fakeClient({ events, indexRow: null, failOn: 'create' })

    const error = await buildConcurrentIndex(client, SPEC).catch(
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(ConcurrentIndexMigrationError)
    expect((error as ConcurrentIndexMigrationError).safeCode).toBe('index_build_failed')
    expect(events).toEqual(['lock', 'inspect', 'create', 'unlock'])
  })
})
