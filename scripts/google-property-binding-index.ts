import { Client, type QueryResult } from 'pg'

export const GOOGLE_PROPERTY_BINDING_INDEX =
  'properties_org_gbp_location_id_unique' as const

export const GOOGLE_PROPERTY_BINDING_INDEX_LOCK =
  'repkey-google-property-binding-index-v1' as const
const EXPECTED_COLUMNS = ['organization_id', 'gbp_location_id'] as const
const EXPECTED_PREDICATE = 'gbp_location_idisnotnullanddeleted_atisnull'

type SqlClient = Readonly<{
  query: <TRow extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<QueryResult<TRow>>
}>

type IndexInspection = Readonly<{
  exists: boolean
  valid: boolean
  ready: boolean
  unique: boolean
  columns: readonly string[]
  predicateMatches: boolean
}>

export type GooglePropertyBindingIndexResult = Readonly<{
  ok: boolean
  code:
    | 'ready'
    | 'created'
    | 'recreated'
    | 'advisory_lock_busy'
    | 'duplicates_found'
    | 'index_invalid'
  duplicateGroups: number
  duplicateRows: number
}>

class GooglePropertyBindingIndexError extends Error {
  constructor(readonly safeCode: string) {
    super(safeCode)
    this.name = 'GooglePropertyBindingIndexError'
  }
}

function integer(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new GooglePropertyBindingIndexError('invalid_database_count')
  }
  return parsed
}

function normalizePredicate(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase().replace(/["()\s]/g, '') : ''
}

async function inspectIndex(client: SqlClient): Promise<IndexInspection> {
  let result: QueryResult<{
    indisvalid: boolean
    indisready: boolean
    indisunique: boolean
    key_columns: string[]
    predicate: string | null
  }>
  try {
    result = await client.query<{
      indisvalid: boolean
      indisready: boolean
      indisunique: boolean
      key_columns: string[]
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
         pg_get_expr(i.indpred, i.indrelid) AS predicate
       FROM pg_index i
       JOIN pg_class index_class ON index_class.oid = i.indexrelid
       JOIN pg_class table_class ON table_class.oid = i.indrelid
       JOIN pg_namespace namespace ON namespace.oid = table_class.relnamespace
       WHERE namespace.nspname = 'public'
         AND table_class.relname = 'properties'
         AND index_class.relname = $1`,
      [GOOGLE_PROPERTY_BINDING_INDEX],
    )
  } catch {
    throw new GooglePropertyBindingIndexError('index_inspection_failed')
  }

  const row = result.rows[0]
  if (!row) {
    return {
      exists: false,
      valid: false,
      ready: false,
      unique: false,
      columns: [],
      predicateMatches: false,
    }
  }
  return {
    exists: true,
    valid: row.indisvalid,
    ready: row.indisready,
    unique: row.indisunique,
    columns: row.key_columns,
    predicateMatches: normalizePredicate(row.predicate) === EXPECTED_PREDICATE,
  }
}

function definitionMatches(index: IndexInspection): boolean {
  return (
    index.exists &&
    index.valid &&
    index.ready &&
    index.unique &&
    index.columns.length === EXPECTED_COLUMNS.length &&
    index.columns.every((column, position) => column === EXPECTED_COLUMNS[position]) &&
    index.predicateMatches
  )
}

async function inspectData(client: SqlClient): Promise<
  Readonly<{
    duplicateGroups: number
    duplicateRows: number
  }>
> {
  try {
    const result = await client.query<{
      duplicate_groups: number
      duplicate_rows: number
    }>(`SELECT
      (
        SELECT count(*)::int
        FROM (
          SELECT 1
          FROM properties
          WHERE gbp_location_id IS NOT NULL AND deleted_at IS NULL
          GROUP BY organization_id, gbp_location_id
          HAVING count(*) > 1
        ) duplicate_groups
      ) AS duplicate_groups,
      (
        SELECT COALESCE(sum(row_count), 0)::int
        FROM (
          SELECT count(*)::int AS row_count
          FROM properties
          WHERE gbp_location_id IS NOT NULL AND deleted_at IS NULL
          GROUP BY organization_id, gbp_location_id
          HAVING count(*) > 1
        ) duplicate_rows
      ) AS duplicate_rows`)
    const row = result.rows[0]
    if (!row) throw new GooglePropertyBindingIndexError('preflight_empty')
    return {
      duplicateGroups: integer(row.duplicate_groups),
      duplicateRows: integer(row.duplicate_rows),
    }
  } catch (error) {
    if (error instanceof GooglePropertyBindingIndexError) throw error
    throw new GooglePropertyBindingIndexError('preflight_failed')
  }
}

export async function inspectGooglePropertyBindingIndex(
  client: SqlClient,
): Promise<GooglePropertyBindingIndexResult> {
  const data = await inspectData(client)
  if (data.duplicateGroups > 0) {
    return { ok: false, code: 'duplicates_found', ...data }
  }
  const index = await inspectIndex(client)
  return {
    ok: definitionMatches(index),
    code: definitionMatches(index) ? 'ready' : 'index_invalid',
    ...data,
  }
}

export async function buildGooglePropertyBindingIndex(
  client: SqlClient,
): Promise<GooglePropertyBindingIndexResult> {
  let acquired: boolean
  try {
    const lock = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
      [GOOGLE_PROPERTY_BINDING_INDEX_LOCK],
    )
    acquired = lock.rows[0]?.acquired === true
  } catch {
    throw new GooglePropertyBindingIndexError('advisory_lock_failed')
  }

  if (!acquired) {
    return {
      ok: false,
      code: 'advisory_lock_busy',
      duplicateGroups: 0,
      duplicateRows: 0,
    }
  }

  try {
    const data = await inspectData(client)
    if (data.duplicateGroups > 0) {
      return { ok: false, code: 'duplicates_found', ...data }
    }

    const before = await inspectIndex(client)
    if (definitionMatches(before)) {
      return { ok: true, code: 'ready', ...data }
    }

    if (before.exists) {
      try {
        await client.query(
          `DROP INDEX CONCURRENTLY IF EXISTS "${GOOGLE_PROPERTY_BINDING_INDEX}"`,
        )
      } catch {
        throw new GooglePropertyBindingIndexError('index_drop_failed')
      }
    }

    try {
      await client.query(
        `CREATE UNIQUE INDEX CONCURRENTLY "${GOOGLE_PROPERTY_BINDING_INDEX}"
         ON "properties" ("organization_id", "gbp_location_id")
         WHERE "gbp_location_id" IS NOT NULL AND "deleted_at" IS NULL`,
      )
    } catch {
      throw new GooglePropertyBindingIndexError('index_build_failed')
    }

    const after = await inspectIndex(client)
    if (!definitionMatches(after)) {
      return { ok: false, code: 'index_invalid', ...data }
    }
    return {
      ok: true,
      code: before.exists ? 'recreated' : 'created',
      ...data,
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [
        GOOGLE_PROPERTY_BINDING_INDEX_LOCK,
      ])
    } catch {
      // The dedicated session closing releases the lock. The result has already
      // been decided; never replace it with a cleanup-only failure.
    }
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error(
      '[google-property-binding-index] failed {"code":"database_url_missing"}',
    )
    process.exitCode = 1
    return
  }

  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    const result = await buildGooglePropertyBindingIndex(client)
    const output = JSON.stringify(result)
    if (result.ok) {
      console.log(`[google-property-binding-index] complete ${output}`)
    } else {
      console.error(`[google-property-binding-index] denied ${output}`)
      process.exitCode = 1
    }
  } catch (error) {
    const code =
      error instanceof GooglePropertyBindingIndexError
        ? error.safeCode
        : 'unexpected_failure'
    console.error(`[google-property-binding-index] failed ${JSON.stringify({ code })}`)
    process.exitCode = 1
  } finally {
    await client.end().catch(() => undefined)
  }
}

const invokedPath = process.argv[1]
if (
  invokedPath &&
  /(?:^|[/\\])google-property-binding-index\.(?:ts|js)$/.test(invokedPath)
) {
  void main()
}
