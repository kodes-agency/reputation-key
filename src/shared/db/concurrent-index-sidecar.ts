/**
 * Autocommit sidecar: builds every index in `concurrent-index-registry.ts`
 * with `CREATE INDEX CONCURRENTLY`, outside the transactional migrator.
 *
 * Called from `scripts/migrate-deploy.ts` after the journaled Drizzle track
 * applies, on the same plain (non-transactional) `pg.Client` — the migrator's
 * own transaction has already committed by then, so the connection is back to
 * autocommit. Advisory-locked per index name and idempotent: a rerun that
 * finds a valid, matching index does nothing, so a redeploy converges instead
 * of rebuilding.
 *
 * Definition matching checks existence, validity, readiness, uniqueness and
 * column order — the same shape the retired `google-property-binding-index.ts`
 * sidecar checked. It deliberately does NOT compare the predicate's SQL text:
 * PostgreSQL's catalog echoes a `WHERE` clause back through its own printer
 * (`pg_get_expr`), which reformats and re-quotes the expression in ways that
 * are impractical to predict for every predicate shape without a live
 * database to calibrate against, and unlike the retired sidecar's single
 * long-lived unique index, every index name registered here is newly minted
 * and only ever built by this module — there is no pre-existing index under
 * the same name that could carry a stale definition. `hasPredicate` still
 * catches the one failure mode that matters: a build that produced an index
 * with no predicate at all (or the reverse).
 */

import type { QueryResult } from 'pg'
import {
  CONCURRENT_INDEX_REGISTRY,
  type ConcurrentIndexSpec,
} from './concurrent-index-registry'

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

export class ConcurrentIndexSidecarError extends Error {
  constructor(readonly safeCode: string) {
    super(safeCode)
    this.name = 'ConcurrentIndexSidecarError'
  }
}

type IndexInspection = Readonly<{
  exists: boolean
  valid: boolean
  ready: boolean
  unique: boolean
  columns: readonly string[]
  hasPredicate: boolean
}>

const NONEXISTENT_INDEX: IndexInspection = Object.freeze({
  exists: false,
  valid: false,
  ready: false,
  unique: false,
  columns: [],
  hasPredicate: false,
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
  }>
  try {
    result = await client.query<{
      indisvalid: boolean
      indisready: boolean
      indisunique: boolean
      key_columns: string[]
      has_predicate: boolean
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
         (i.indpred IS NOT NULL) AS has_predicate
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
    throw new ConcurrentIndexSidecarError('index_inspection_failed')
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
  }
}

function definitionMatches(spec: ConcurrentIndexSpec, index: IndexInspection): boolean {
  return (
    index.exists &&
    index.valid &&
    index.ready &&
    index.unique === spec.unique &&
    index.hasPredicate === spec.hasPredicate &&
    index.columns.length === spec.columns.length &&
    index.columns.every((column, position) => column === spec.columns[position])
  )
}

/**
 * Builds one registered index if it does not already exist in a matching,
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
    throw new ConcurrentIndexSidecarError('advisory_lock_failed')
  }

  if (!acquired) {
    return { name: spec.name, ok: false, code: 'advisory_lock_busy' }
  }

  try {
    const before = await inspectIndex(client, spec)
    if (definitionMatches(spec, before)) {
      return { name: spec.name, ok: true, code: 'ready' }
    }

    // Only reached when a prior build crashed mid-CONCURRENTLY and left an
    // invalid index under this name; a fresh registry entry never starts here.
    if (before.exists) {
      try {
        await client.query(`DROP INDEX CONCURRENTLY IF EXISTS "${spec.name}"`)
      } catch {
        throw new ConcurrentIndexSidecarError('index_drop_failed')
      }
    }

    try {
      await client.query(spec.createSql)
    } catch {
      throw new ConcurrentIndexSidecarError('index_build_failed')
    }

    const after = await inspectIndex(client, spec)
    if (!definitionMatches(spec, after)) {
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

/**
 * Builds every registered index, one at a time. Sequential rather than
 * concurrent: two CONCURRENTLY builds on the same table queue on the same
 * relation lock anyway, and running one at a time keeps each failure isolated
 * and attributable in the deploy log.
 */
export async function buildRegisteredConcurrentIndexes(
  client: SqlClient,
): Promise<readonly ConcurrentIndexResult[]> {
  const results: ConcurrentIndexResult[] = []
  for (const spec of CONCURRENT_INDEX_REGISTRY) {
    results.push(await buildConcurrentIndex(client, spec))
  }
  return results
}
