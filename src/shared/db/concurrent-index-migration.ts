/** Recoverable autocommit execution for a journaled concurrent index file. */

import { randomUUID } from 'node:crypto'
import type { QueryResult } from 'pg'
import {
  journalConcurrentIndex,
  type ConcurrentIndexSpec,
} from './journal-concurrent-index'

const LOCK_NAMESPACE = 'repkey-concurrent-index-sidecar-v1'

export type SqlClient = Readonly<{
  query: <TRow extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<QueryResult<TRow>>
}>

export type ConcurrentIndexResultCode =
  'ready' | 'created' | 'recreated' | 'advisory_lock_busy' | 'index_invalid'

export type ConcurrentIndexResult = Readonly<{
  name: string
  ok: boolean
  code: ConcurrentIndexResultCode
}>

export class ConcurrentIndexMigrationError extends Error {
  constructor(
    readonly safeCode: string,
    readonly code?: string,
  ) {
    super(safeCode)
    this.name = 'ConcurrentIndexMigrationError'
  }
}

type IndexInspection = Readonly<{
  exists: boolean
  valid: boolean
  ready: boolean
  unique: boolean
  columns: readonly string[]
  hasPredicate: boolean
  predicate: string | null
}>

const NONEXISTENT_INDEX: IndexInspection = Object.freeze({
  exists: false,
  valid: false,
  ready: false,
  unique: false,
  columns: [],
  hasPredicate: false,
  predicate: null,
})

function lockKey(spec: ConcurrentIndexSpec): string {
  return `${LOCK_NAMESPACE}:${spec.name}`
}

async function inspectIndex(
  client: SqlClient,
  spec: ConcurrentIndexSpec,
): Promise<IndexInspection> {
  let result: QueryResult<{
    indisvalid: boolean
    indisready: boolean
    indisunique: boolean
    key_columns: string[]
    has_predicate: boolean
    predicate: string | null
  }>
  try {
    result = await client.query<{
      indisvalid: boolean
      indisready: boolean
      indisunique: boolean
      key_columns: string[]
      has_predicate: boolean
      predicate: string | null
    }>(
      `SELECT
         i.indisvalid,
         i.indisready,
         i.indisunique,
         ARRAY(
           SELECT a.attname::text
           FROM unnest(i.indkey::smallint[]) WITH ORDINALITY AS key(attnum, ordinal)
           JOIN pg_attribute a
             ON a.attrelid = i.indrelid AND a.attnum = key.attnum
           WHERE key.ordinal <= i.indnkeyatts
           ORDER BY key.ordinal
         ) AS key_columns,
         (i.indpred IS NOT NULL) AS has_predicate,
         pg_get_expr(i.indpred, i.indrelid) AS predicate
       FROM pg_index i
       JOIN pg_class index_class ON index_class.oid = i.indexrelid
       JOIN pg_class table_class ON table_class.oid = i.indrelid
       JOIN pg_namespace namespace ON namespace.oid = table_class.relnamespace
       WHERE namespace.nspname = 'public'
         AND table_class.relname = $1
         AND index_class.relname = $2`,
      [spec.table, spec.name],
    )
  } catch {
    throw new ConcurrentIndexMigrationError('index_inspection_failed')
  }

  const row = result.rows[0]
  if (!row) return NONEXISTENT_INDEX
  return {
    exists: true,
    valid: row.indisvalid,
    ready: row.indisready,
    unique: row.indisunique,
    columns: row.key_columns,
    hasPredicate: row.has_predicate,
    predicate: row.predicate,
  }
}

async function expectedPredicate(
  client: SqlClient,
  spec: ConcurrentIndexSpec,
): Promise<string | null> {
  if (!spec.hasPredicate) return null
  const definition = journalConcurrentIndex(
    `-- migrate:nontransactional\n${spec.createSql}`,
  )
  if (!definition?.predicate)
    throw new ConcurrentIndexMigrationError('index_definition_failed')
  const table = `index_predicate_${randomUUID().replaceAll('-', '')}`
  // Let PostgreSQL resolve casts, operators and parentheses on an empty copy.
  // Text normalization could equate different literals or boolean groupings.
  try {
    await client.query(`CREATE TEMP TABLE "${table}" (LIKE public."${definition.table}")`)
    try {
      const columns = definition.columns.map((column) => `"${column}"`).join(', ')
      await client.query(
        `CREATE INDEX ON pg_temp."${table}" (${columns}) WHERE ${definition.predicate}`,
      )
      const result = await client.query<{ expected_predicate: string }>(
        'SELECT pg_get_expr(indpred, indrelid) AS expected_predicate FROM pg_index WHERE indrelid = $1::regclass',
        [`pg_temp."${table}"`],
      )
      const predicate = result.rows[0]?.expected_predicate
      if (!predicate) throw new Error('Missing index predicate')
      return predicate
    } finally {
      await client.query(`DROP TABLE pg_temp."${table}"`)
    }
  } catch {
    throw new ConcurrentIndexMigrationError('index_definition_failed')
  }
}

function definitionMatches(
  spec: ConcurrentIndexSpec,
  index: IndexInspection,
  predicate: string | null,
): boolean {
  return (
    index.exists &&
    index.valid &&
    index.ready &&
    index.unique === spec.unique &&
    index.hasPredicate === spec.hasPredicate &&
    index.predicate === predicate &&
    index.columns.length === spec.columns.length &&
    index.columns.every((column, position) => column === spec.columns[position])
  )
}

/**
 * Builds one journaled index if it does not already exist in a matching,
 * valid state. Never runs inside a transaction — `CREATE INDEX CONCURRENTLY`
 * would be refused.
 */
export async function buildConcurrentIndex(
  client: SqlClient,
  spec: ConcurrentIndexSpec,
): Promise<ConcurrentIndexResult> {
  let acquired: boolean
  try {
    const lock = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
      [lockKey(spec)],
    )
    acquired = lock.rows[0]?.acquired === true
  } catch {
    throw new ConcurrentIndexMigrationError('advisory_lock_failed')
  }

  if (!acquired) {
    return { name: spec.name, ok: false, code: 'advisory_lock_busy' }
  }

  try {
    const before = await inspectIndex(client, spec)
    const predicate = await expectedPredicate(client, spec)
    if (definitionMatches(spec, before, predicate)) {
      return { name: spec.name, ok: true, code: 'ready' }
    }

    // An interrupted build or an unrecorded build of different SQL must be replaced.
    if (before.exists) {
      try {
        await client.query(`DROP INDEX CONCURRENTLY IF EXISTS "${spec.name}"`)
      } catch {
        throw new ConcurrentIndexMigrationError('index_drop_failed')
      }
    }

    try {
      await client.query(spec.createSql)
    } catch {
      throw new ConcurrentIndexMigrationError('index_build_failed')
    }

    const after = await inspectIndex(client, spec)
    if (!definitionMatches(spec, after, predicate)) {
      return { name: spec.name, ok: false, code: 'index_invalid' }
    }
    return { name: spec.name, ok: true, code: before.exists ? 'recreated' : 'created' }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [
        lockKey(spec),
      ])
    } catch {
      // The deploy session closing at the end of the run releases the lock
      // regardless; the build result above has already been decided.
    }
  }
}
