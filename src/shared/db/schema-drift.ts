// Semantic schema drift comparator (BQC-5.4).
//
// The migration SQL track is the schema authority (see ./CONTEXT.md). This
// module verifies the Drizzle model (src/shared/db/schema/*.ts) semantically
// against the actually-migrated PostgreSQL metadata — not symbol presence:
//   - tables / columns / types / nullability / defaults
//   - primary keys, unique constraints, check constraints (expression-level)
//   - foreign keys incl. ON DELETE / ON UPDATE actions
//   - indexes: ordered key columns, direction, expressions, partial predicates
//   - pg enum labels for enum columns
//   - migration journal continuity (drizzle.__drizzle_migrations vs
//     drizzle/meta/_journal.json, incl. per-file SQL hashes)
//   - registered DB-only constructs (schema/db-only-constructs.ts) exist in
//     pg_catalog, and no UNREGISTERED triggers/functions/indexes/checks/
//     enum types lurk in pg_catalog (both directions closed).
//
// Consumed by the integration test (migration-verification.test.ts) and by
// scripts/check-schema-drift.ts. Shared/db may import drizzle-orm + pg.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { getTableName, isTable, SQL } from 'drizzle-orm'
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core'
import type { Index, PgColumn } from 'drizzle-orm/pg-core'
import * as schema from './schema'
import * as googleImportCompatibilitySchema from './schema/google-import-compatibility.schema'
import { DB_ONLY_CONSTRUCTS } from './schema/db-only-constructs'

// ─── Types ──────────────────────────────────────────────────────────

export type DriftKind =
  | 'missing-in-db'
  | 'extra-in-db'
  | 'mismatch'
  | 'unregistered-db-object'
  | 'missing-registered-object'
  | 'journal'

export type Drift = Readonly<{
  kind: DriftKind
  /** e.g. 'table outbox_events' or 'index outbox_events_lease_expires_idx'. */
  object: string
  detail: string
}>

/** Minimal query contract — satisfied by pg Pool / PoolClient / Client. */
export type Queryable = {
  query(text: string): Promise<{ rows: Record<string, unknown>[] }>
}

type ModelColumn = Readonly<{
  name: string
  type: string
  notNull: boolean
  defaultSql: string | null
  primary: boolean
  isUnique: boolean
  enumName: string | null
  enumValues: readonly string[] | null
}>

type ModelIndex = Readonly<{
  name: string
  unique: boolean
  columns: readonly string[]
  predicate: string | null
}>

type ModelFk = Readonly<{
  columns: readonly string[]
  refTable: string
  refColumns: readonly string[]
  onDelete: string
  onUpdate: string
}>

type ModelCheck = Readonly<{ name: string; expr: string }>

type ModelTable = Readonly<{
  name: string
  isAuth: boolean
  columns: readonly ModelColumn[]
  primaryKey: readonly string[]
  uniques: readonly (readonly string[])[]
  foreignKeys: readonly ModelFk[]
  checks: readonly ModelCheck[]
  indexes: readonly ModelIndex[]
}>

type DbColumn = Readonly<{
  table: string
  name: string
  type: string
  nullable: boolean
  defaultSql: string | null
}>

type DbConstraint = Readonly<{
  table: string
  name: string
  type: 'p' | 'u' | 'c' | 'f'
  definition: string
  columns: readonly string[]
  refTable: string | null
  refColumns: readonly string[]
  onUpdate: string | null
  onDelete: string | null
}>

type DbIndex = Readonly<{
  table: string
  name: string
  unique: boolean
  columns: readonly string[]
  included: readonly string[]
  predicate: string | null
}>

type Catalog = Readonly<{
  tables: ReadonlySet<string>
  columns: ReadonlyMap<string, readonly DbColumn[]>
  constraints: readonly DbConstraint[]
  indexes: readonly DbIndex[]
  indexNames: ReadonlySet<string>
  enums: ReadonlyMap<string, readonly string[]>
  triggers: ReadonlySet<string>
  functions: ReadonlySet<string>
  views: readonly string[]
  matviews: readonly string[]
  journal: readonly { hash: string; createdAt: number }[]
}>

// ─── Constants ──────────────────────────────────────────────────────

/** Better Auth schema track — model mirror is compared columns-only. */
const AUTH_TABLES = new Set([
  'user',
  'session',
  'account',
  'verification',
  'organization',
  'member',
  'invitation',
  'organizationRole',
])

/** Test-harness tables created at runtime, never part of the deploy schema. */
const TEST_INFRA_TABLES = new Set(['_test_lease'])

const FK_ACTION: Record<string, string> = {
  a: 'no action',
  r: 'restrict',
  c: 'cascade',
  n: 'set null',
  d: 'set default',
}

// ─── SQL expression normalization ───────────────────────────────────

const MULTIWORD_CAST =
  /::\s*(timestamp with(?:out)? time zone|character varying|double precision)/g
// eslint-disable-next-line security/detect-unsafe-regex -- BQC-7.7 (owner: platform): char-class-only cast stripper, no nested quantifiers; safe-regex star-height false positive
const SIMPLE_CAST = /::\s*"?[a-z0-9_]+"?(\s*\[\s*\])?/g
const TABLE_QUALIFIER = /\b[a-z_][a-z0-9_]*\.(?=[a-z_])/g
const NOT_IN_LIST = /(\w+)\s+not\s+in\s*\(([^()]*?)\)/g
const IN_LIST = /(\w+)\s+in\s*\(([^()]*?)\)/g
// timestamptz defaults render in the SERVER timezone (e.g. '1970-01-01
// 00:00:00+02'); canonicalize date/time literals so comparison is TZ-stable.
const BARE_DATE = /'(\d{4}-\d{2}-\d{2})'/g
const TZ_OFFSET = /(\d{2}:\d{2}:\d{2})\s*[+-]\d{2}(?=')/g
const BETWEEN_RANGE =
  // eslint-disable-next-line security/detect-unsafe-regex -- schema-owned SQL only; bounded DDL, never request input
  /(\w+(?:\([^()]*(?:\([^()]*\)[^()]*)*\))?)\s+between\s+([^\s]+)\s+and\s+([^\s]+)/g
const INTERVAL_LITERAL = /interval\s+'([^']+)'/g
const INTERVAL_EQUIVALENTS: Readonly<Record<string, string>> = {
  '24 hours': '24:00:00',
  '5 minutes': '00:05:00',
}

/**
 * Canonicalize a SQL fragment from either world (drizzle model render or
 * pg_get_expr / pg_get_constraintdef / information_schema default) so the two
 * can be compared as strings: lowercase, drop casts/quotes/qualifiers, map
 * IN-lists to pg's canonical = ANY (ARRAY[...]) form, then drop ALL parens.
 * Paren removal is sound here because both sides receive the identical
 * treatment (predicates in this schema are flat AND/OR/IN expressions).
 */
function normalizeExpr(raw: string): string {
  let s = raw.toLowerCase()
  s = s.replace(MULTIWORD_CAST, '').replace(SIMPLE_CAST, '')
  s = s.replace(/current_timestamp/g, 'now()')
  s = s.replace(BARE_DATE, "'$1 00:00:00'").replace(TZ_OFFSET, '$1')
  s = s.replace(/"/g, '').replace(TABLE_QUALIFIER, '')
  s = s.replace(NOT_IN_LIST, '$1 <> all array[$2]').replace(IN_LIST, '$1 = any array[$2]')
  s = s.replace(BETWEEN_RANGE, '$1 >= $2 and $1 <= $3')
  s = s.replace(
    INTERVAL_LITERAL,
    (_match, value: string) => `'${INTERVAL_EQUIVALENTS[value] ?? value}'`,
  )
  s = s.replace(/[()]/g, '').replace(/\s+/g, ' ').trim()
  s = s.replace(/\s*(->>|->|#>>|#>)\s*/g, '$1')
  return s
    .replace(/\s*,\s*/g, ',')
    .replace(/\s*\[\s*/g, '[')
    .replace(/\s*]\s*/g, ']')
    .replace(/\s+(and|or)\s+/g, '$1')
    .trim()
}

// ─── Model extraction ───────────────────────────────────────────────

const dialect = new PgDialect()

type LooseColumn = PgColumn & {
  enum?: { enumName: string; enumValues: readonly string[] }
  length?: number
  withTimezone?: boolean
  default?: unknown
  defaultFn?: () => unknown
}

function renderSql(fragment: SQL): string {
  const { sql, params } = dialect.sqlToQuery(fragment)
  let out = sql
  for (let i = params.length; i >= 1; i--) {
    out = out.replaceAll(`$${i}`, formatLiteral(params[i - 1]))
  }
  return out
}

function formatLiteral(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value)
  }
  if (value instanceof Date) return `'${value.toISOString()}'`
  return `'${JSON.stringify(value)}'`
}

const COLUMN_TYPE_MAP: Record<string, string> = {
  PgText: 'text',
  PgChar: 'char',
  PgInteger: 'int',
  PgSerial: 'int',
  PgSmallint: 'smallint',
  PgSmallSerial: 'smallint',
  PgBigint: 'bigint',
  PgBigSerial: 'bigint',
  PgBoolean: 'boolean',
  PgUUID: 'uuid',
  PgDate: 'date',
  PgTime: 'time',
  PgJson: 'json',
  PgJsonb: 'jsonb',
  PgNumeric: 'numeric',
  PgDoublePrecision: 'float8',
  PgReal: 'float4',
}

function canonicalModelType(col: LooseColumn): string {
  if (col.enum) return `enum:${col.enum.enumName}`
  if (col.columnType === 'PgVarchar') {
    return col.length != null ? `varchar(${col.length})` : 'varchar'
  }
  if (col.columnType === 'PgTimestamp') {
    return col.withTimezone ? 'timestamptz' : 'timestamp'
  }
  return COLUMN_TYPE_MAP[col.columnType] ?? String(col.getSQLType()).toLowerCase()
}

function modelDefault(col: LooseColumn): string | null {
  if (!col.hasDefault) return null
  if (col.default instanceof SQL) return normalizeExpr(renderSql(col.default))
  if (col.default !== undefined) return normalizeExpr(formatLiteral(col.default))
  // defaultFn / $defaultFn are app-side defaults (JS-generated at insert
  // time) — the database has no counterpart, so there is nothing to compare.
  return null
}

function toModelColumn(col: PgColumn): ModelColumn {
  const loose = col as LooseColumn
  return {
    name: col.name,
    type: canonicalModelType(loose),
    notNull: col.notNull,
    defaultSql: modelDefault(loose),
    primary: col.primary,
    isUnique: col.isUnique,
    enumName: loose.enum?.enumName ?? null,
    enumValues: loose.enum?.enumValues ?? null,
  }
}

type IndexedColumnShape = { name?: string; indexConfig?: { order?: string } }

// Index columns arrive in three shapes: raw SQL fragments (expressions or
// `desc(col)` from drizzle-orm/sql), IndexedColumn wrappers (from the column
// method `col.desc()` — direction lives in indexConfig.order), and plain
// PgColumn references (ascending; pg's default nulls ordering is assumed on
// both sides, so NULLS FIRST/LAST markers are not compared).
function toIndexColumnExpr(c: unknown): string {
  if (c instanceof SQL) return normalizeExpr(renderSql(c))
  const col = c as IndexedColumnShape
  const base = normalizeExpr(col.name ?? '')
  return col.indexConfig?.order === 'desc' ? `${base} desc` : base
}

function toModelIndex(ix: Index): ModelIndex {
  return {
    name: ix.config.name ?? '',
    unique: ix.config.unique,
    columns: ix.config.columns.map(toIndexColumnExpr),
    predicate: ix.config.where ? normalizeExpr(renderSql(ix.config.where)) : null,
  }
}

function toModelFk(fk: {
  reference: () => {
    foreignTable: Parameters<typeof getTableName>[0]
    columns: readonly PgColumn[]
    foreignColumns: readonly PgColumn[]
  }
  onDelete?: string
  onUpdate?: string
}): ModelFk {
  const ref = fk.reference()
  return {
    columns: ref.columns.map((c) => c.name),
    refTable: getTableName(ref.foreignTable),
    refColumns: ref.foreignColumns.map((c) => c.name),
    onDelete: fk.onDelete ?? 'no action',
    onUpdate: fk.onUpdate ?? 'no action',
  }
}

type TableConfig = ReturnType<typeof getTableConfig>

function modelPrimaryKey(cfg: TableConfig): readonly string[] {
  if (cfg.primaryKeys.length > 0) {
    return cfg.primaryKeys.flatMap((pk) => pk.columns.map((c) => c.name))
  }
  return cfg.columns.filter((c) => c.primary).map((c) => c.name)
}

function modelUniques(cfg: TableConfig): readonly (readonly string[])[] {
  const fromConstraints = cfg.uniqueConstraints.map((u) => u.columns.map((c) => c.name))
  const inline = cfg.columns.filter((c) => c.isUnique).map((c) => [c.name])
  return [...fromConstraints, ...inline]
}

function toModelTable(table: Parameters<typeof getTableConfig>[0]): ModelTable {
  const cfg = getTableConfig(table)
  return {
    name: cfg.name,
    isAuth: AUTH_TABLES.has(cfg.name),
    columns: cfg.columns.map(toModelColumn),
    primaryKey: modelPrimaryKey(cfg),
    uniques: modelUniques(cfg),
    foreignKeys: cfg.foreignKeys.map(toModelFk),
    checks: cfg.checks.map((c) => ({
      name: c.name,
      expr: normalizeExpr(renderSql(c.value)),
    })),
    indexes: cfg.indexes.map(toModelIndex),
  }
}

/** Every pgTable exported by the schema barrel (all 68 tables). */
function extractModel(): readonly ModelTable[] {
  const tables = Object.values(schema).filter(isTable) as Parameters<
    typeof getTableConfig
  >[0][]
  return tables.map(toModelTable).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Expand-schema bridge columns remain queryable only by the compatibility
 * binary. The contract-ready table definitions deliberately omit them so the
 * same code runs after contract DDL. While the durable compatibility control
 * table exists, augment the drift-only model with the exact frozen bridge
 * shape; this still validates every column, predicate, and identity check.
 */
function withGoogleImportExpandBridge(
  model: readonly ModelTable[],
  catalog: Catalog,
): readonly ModelTable[] {
  if (!catalog.tables.has('legacy_import_control')) return model

  const compatibilityTables = Object.values(googleImportCompatibilitySchema)
    .filter(isTable)
    .map((table) => toModelTable(table as Parameters<typeof getTableConfig>[0]))

  return [...model, ...compatibilityTables].map((table): ModelTable => {
    if (table.name === 'google_connections') {
      return {
        ...table,
        columns: [
          ...table.columns,
          {
            name: 'google_account_id',
            type: 'varchar(255)',
            notNull: false,
            defaultSql: null,
            primary: false,
            isUnique: false,
            enumName: null,
            enumValues: null,
          },
          {
            name: 'google_email',
            type: 'varchar(255)',
            notNull: false,
            defaultSql: null,
            primary: false,
            isUnique: false,
            enumName: null,
            enumValues: null,
          },
        ],
        checks: table.checks.map((check) =>
          check.name === 'google_connections_identity_check'
            ? {
                ...check,
                expr:
                  'google_subject is not nullandgoogle_account_id is nullandgoogle_email is nullor' +
                  'google_subject is nullandgoogle_account_id is not nullandgoogle_email is not nullor' +
                  "status = 'disconnected'andgoogle_subject is nullandgoogle_account_id is nullandgoogle_email is null",
              }
            : check,
        ),
        indexes: [
          ...table.indexes,
          {
            name: 'google_connections_google_account_idx',
            unique: true,
            columns: ['google_account_id'],
            predicate: 'google_account_id is not null',
          },
        ],
      }
    }

    if (table.name === 'properties') {
      return {
        ...table,
        columns: [
          ...table.columns,
          {
            name: 'gbp_place_id',
            type: 'varchar(500)',
            notNull: false,
            defaultSql: null,
            primary: false,
            isUnique: false,
            enumName: null,
            enumValues: null,
          },
        ],
        indexes: [
          ...table.indexes,
          {
            name: 'properties_org_gbp_place_id_unique',
            unique: true,
            columns: ['organization_id', 'gbp_place_id'],
            predicate: 'gbp_place_id is not nullanddeleted_at is null',
          },
        ],
      }
    }

    return table
  })
}

// ─── Catalog extraction ─────────────────────────────────────────────

const COLUMNS_SQL = `SELECT table_name, column_name, udt_name, is_nullable, column_default,
       character_maximum_length, numeric_precision, numeric_scale
  FROM information_schema.columns
  WHERE table_schema = 'public'`

const CONSTRAINTS_SQL = `SELECT cls.relname AS table_name, con.conname, con.contype,
       pg_get_constraintdef(con.oid) AS definition,
       con.confupdtype, con.confdeltype,
       ARRAY(SELECT attname FROM pg_attribute
              WHERE attrelid = con.conrelid AND attnum = ANY(con.conkey)
              ORDER BY array_position(con.conkey, attnum))::text[] AS cols,
       ref.relname AS ref_table,
       COALESCE(ARRAY(SELECT attname FROM pg_attribute
              WHERE attrelid = con.confrelid AND attnum = ANY(con.confkey)
              ORDER BY array_position(con.confkey, attnum))::text[], '{}') AS ref_cols
  FROM pg_constraint con
  JOIN pg_class cls ON cls.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = cls.relnamespace AND ns.nspname = 'public'
  LEFT JOIN pg_class ref ON ref.oid = con.confrelid`

// Per-key-column definitions via pg_get_indexdef(oid, n, pretty) (which omit
// ASC/DESC) plus the direction bit from indoption (bit 1 = DESC). Key columns
// are positions 1..indnkeyatts; anything beyond is an INCLUDE column.
// Primary-key and unique-CONSTRAINT-backing indexes are compared via the
// constraint path instead (an FK's conindid only points at the index that
// enforces its referenced uniqueness — that does not make it owned), so only
// contype 'u' ownership is excluded here.
const INDEXES_SQL = `SELECT cls.relname AS table_name, idx.relname AS index_name,
       ix.indisunique,
       ARRAY(SELECT pg_get_indexdef(ix.indexrelid, k + 1, true) ||
                    CASE WHEN (ix.indoption[k] & 1) = 1 THEN ' desc' ELSE '' END
              FROM generate_series(0, ix.indnkeyatts - 1) AS k)::text[] AS cols,
       COALESCE(ARRAY(SELECT pg_get_indexdef(ix.indexrelid, k + 1, true)
              FROM generate_series(ix.indnkeyatts, ix.indnatts - 1) AS k)::text[], '{}') AS included,
       pg_get_expr(ix.indpred, ix.indrelid) AS predicate
  FROM pg_index ix
  JOIN pg_class cls ON cls.oid = ix.indrelid
  JOIN pg_class idx ON idx.oid = ix.indexrelid
  JOIN pg_namespace ns ON ns.oid = cls.relnamespace AND ns.nspname = 'public'
  WHERE NOT ix.indisprimary
    AND NOT EXISTS (SELECT 1 FROM pg_constraint c
                     WHERE c.conindid = ix.indexrelid AND c.contype = 'u')`

const ALL_INDEX_NAMES_SQL = `SELECT idx.relname AS index_name
  FROM pg_index ix
  JOIN pg_class idx ON idx.oid = ix.indexrelid
  JOIN pg_namespace ns ON ns.oid = idx.relnamespace AND ns.nspname = 'public'`

const ENUMS_SQL = `SELECT t.typname, e.enumlabel
  FROM pg_type t
  JOIN pg_enum e ON e.enumtypid = t.oid
  JOIN pg_namespace n ON n.oid = t.typnamespace AND n.nspname = 'public'
  ORDER BY t.typname, e.enumsortorder`

function canonicalDbType(row: Record<string, unknown>): string {
  const udt = String(row.udt_name)
  if (udt === 'varchar') {
    return row.character_maximum_length != null
      ? `varchar(${row.character_maximum_length})`
      : 'varchar'
  }
  if (udt === 'numeric') {
    return row.numeric_precision != null
      ? `numeric(${row.numeric_precision}, ${row.numeric_scale})`
      : 'numeric'
  }
  if (udt.startsWith('_')) {
    const arrayTypeAliases: Readonly<Record<string, string>> = {
      int4: 'integer',
      int8: 'bigint',
      int2: 'smallint',
      bool: 'boolean',
    }
    const element = udt.slice(1)
    return `${arrayTypeAliases[element] ?? element}[]`
  }
  const mapped: Record<string, string> = {
    int4: 'int',
    int8: 'bigint',
    int2: 'smallint',
    bool: 'boolean',
    float8: 'float8',
    float4: 'float4',
    bpchar: 'char',
  }
  return mapped[udt] ?? udt
}

function toDbColumn(row: Record<string, unknown>): DbColumn {
  return {
    table: String(row.table_name),
    name: String(row.column_name),
    type: canonicalDbType(row),
    nullable: row.is_nullable === 'YES',
    defaultSql:
      row.column_default != null ? normalizeExpr(String(row.column_default)) : null,
  }
}

function toDbConstraint(row: Record<string, unknown>): DbConstraint {
  return {
    table: String(row.table_name),
    name: String(row.conname),
    type: String(row.contype) as DbConstraint['type'],
    // pg_get_constraintdef prefixes CHECK definitions with the 'CHECK' keyword.
    definition: normalizeExpr(String(row.definition)).replace(/^check\s+/, ''),
    columns: (row.cols as string[]) ?? [],
    refTable: row.ref_table != null ? String(row.ref_table) : null,
    refColumns: (row.ref_cols as string[]) ?? [],
    onUpdate: row.confupdtype != null ? FK_ACTION[String(row.confupdtype)]! : null,
    onDelete: row.confdeltype != null ? FK_ACTION[String(row.confdeltype)]! : null,
  }
}

function toDbIndex(row: Record<string, unknown>): DbIndex {
  return {
    table: String(row.table_name),
    name: String(row.index_name),
    unique: Boolean(row.indisunique),
    columns: ((row.cols as string[]) ?? []).map(normalizeExpr),
    included: ((row.included as string[]) ?? []).map(normalizeExpr),
    predicate: row.predicate != null ? normalizeExpr(String(row.predicate)) : null,
  }
}

function groupColumns(rows: readonly DbColumn[]): Map<string, readonly DbColumn[]> {
  const byTable = new Map<string, DbColumn[]>()
  for (const col of rows) {
    const list = byTable.get(col.table) ?? []
    list.push(col)
    byTable.set(col.table, list)
  }
  return byTable
}

function groupEnums(rows: readonly Record<string, unknown>[]): Map<string, string[]> {
  const byName = new Map<string, string[]>()
  for (const row of rows) {
    const list = byName.get(String(row.typname)) ?? []
    list.push(String(row.enumlabel))
    byName.set(String(row.typname), list)
  }
  return byName
}

async function fetchCatalog(q: Queryable): Promise<Catalog> {
  const tables = await q.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  )
  const columns = await q.query(COLUMNS_SQL)
  const constraints = await q.query(CONSTRAINTS_SQL)
  const indexes = await q.query(INDEXES_SQL)
  const indexNames = await q.query(ALL_INDEX_NAMES_SQL)
  const enums = await q.query(ENUMS_SQL)
  const triggers = await q.query(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`)
  const functions = await q.query(
    `SELECT p.proname FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prokind = 'f'
        AND NOT EXISTS (
          SELECT 1
          FROM pg_depend d
          JOIN pg_extension e ON e.oid = d.refobjid
          WHERE d.classid = 'pg_proc'::regclass
            AND d.objid = p.oid
            AND d.deptype = 'e'
        )`,
  )
  const views = await q.query(`SELECT viewname FROM pg_views WHERE schemaname = 'public'`)
  const matviews = await q.query(
    `SELECT matviewname FROM pg_matviews WHERE schemaname = 'public'`,
  )
  const journal = await q.query(
    `SELECT hash, created_at::text AS created_at FROM drizzle.__drizzle_migrations
      ORDER BY created_at, id`,
  )
  return {
    tables: new Set(tables.rows.map((r) => String(r.tablename))),
    columns: groupColumns(columns.rows.map(toDbColumn)),
    constraints: constraints.rows.map(toDbConstraint),
    indexes: indexes.rows.map(toDbIndex),
    indexNames: new Set(indexNames.rows.map((r) => String(r.index_name))),
    enums: groupEnums(enums.rows),
    triggers: new Set(triggers.rows.map((r) => String(r.tgname))),
    functions: new Set(functions.rows.map((r) => String(r.proname))),
    views: views.rows.map((r) => String(r.viewname)),
    matviews: matviews.rows.map((r) => String(r.matviewname)),
    journal: journal.rows.map((r) => ({
      hash: String(r.hash),
      createdAt: Number(r.created_at),
    })),
  }
}

// ─── Comparison ─────────────────────────────────────────────────────

function drift(kind: DriftKind, object: string, detail: string): Drift {
  return { kind, object, detail }
}

function compareColumn(model: ModelColumn, db: DbColumn, table: string): Drift[] {
  const drifts: Drift[] = []
  const object = `column ${table}.${model.name}`
  // Model enum columns carry 'enum:<type>'; the catalog reports the bare type.
  const typesMatch = model.type.startsWith('enum:')
    ? db.type === model.type.slice(5)
    : model.type === db.type
  if (!typesMatch) {
    drifts.push(drift('mismatch', object, `type: model ${model.type} vs db ${db.type}`))
  }
  if (model.notNull === db.nullable) {
    drifts.push(
      drift(
        'mismatch',
        object,
        `nullability: model notNull=${model.notNull} vs db nullable=${db.nullable}`,
      ),
    )
  }
  if (model.defaultSql !== db.defaultSql && !db.defaultSql?.startsWith('nextval')) {
    drifts.push(
      drift(
        'mismatch',
        object,
        `default: model ${model.defaultSql ?? '∅'} vs db ${db.defaultSql ?? '∅'}`,
      ),
    )
  }
  return drifts
}

function compareColumns(model: ModelTable, db: readonly DbColumn[]): Drift[] {
  const drifts: Drift[] = []
  const dbByName = new Map(db.map((c) => [c.name, c]))
  for (const col of model.columns) {
    const found = dbByName.get(col.name)
    if (!found) {
      drifts.push(
        drift(
          'missing-in-db',
          `column ${model.name}.${col.name}`,
          'declared in model, absent in db',
        ),
      )
    } else {
      drifts.push(...compareColumn(col, found, model.name))
    }
  }
  for (const col of db) {
    if (!model.columns.some((c) => c.name === col.name)) {
      drifts.push(
        drift(
          'extra-in-db',
          `column ${model.name}.${col.name}`,
          'present in db, absent in model',
        ),
      )
    }
  }
  return drifts
}

function colSetKey(columns: readonly string[]): string {
  return [...columns].sort().join(',')
}

function comparePrimaryKey(model: ModelTable, dbPk: DbConstraint | undefined): Drift[] {
  const object = `primary key ${model.name}`
  if (model.primaryKey.length === 0 && !dbPk) return []
  if (!dbPk)
    return [drift('missing-in-db', object, `model pk [${model.primaryKey}] absent in db`)]
  if (model.primaryKey.length === 0) {
    return [
      drift('extra-in-db', object, `db pk [${dbPk.columns}] has no model counterpart`),
    ]
  }
  if (model.primaryKey.join(',') !== dbPk.columns.join(',')) {
    return [
      drift('mismatch', object, `model [${model.primaryKey}] vs db [${dbPk.columns}]`),
    ]
  }
  return []
}

function compareUniques(model: ModelTable, dbUniques: readonly DbConstraint[]): Drift[] {
  const drifts: Drift[] = []
  const modelSets = new Set(model.uniques.map(colSetKey))
  const dbSets = new Map(dbUniques.map((u) => [colSetKey(u.columns), u]))
  for (const key of modelSets) {
    if (!dbSets.has(key)) {
      drifts.push(
        drift(
          'missing-in-db',
          `unique ${model.name}(${key})`,
          'declared in model, absent in db',
        ),
      )
    }
  }
  for (const [key, u] of dbSets) {
    if (!modelSets.has(key)) {
      drifts.push(
        drift(
          'extra-in-db',
          `unique ${u.name} on ${model.name}(${key})`,
          'present in db, absent in model',
        ),
      )
    }
  }
  return drifts
}

function fkKey(columns: readonly string[], refTable: string): string {
  return `${columns.join(',')}→${refTable}`
}

function compareFkPair(model: ModelTable, fk: ModelFk, db: DbConstraint): Drift[] {
  const object = `fk ${model.name}(${fk.columns})→${fk.refTable}`
  const drifts: Drift[] = []
  if (fk.refColumns.join(',') !== db.refColumns.join(',')) {
    drifts.push(
      drift(
        'mismatch',
        object,
        `ref columns: model [${fk.refColumns}] vs db [${db.refColumns}]`,
      ),
    )
  }
  if (fk.onDelete !== db.onDelete) {
    drifts.push(
      drift('mismatch', object, `on delete: model ${fk.onDelete} vs db ${db.onDelete}`),
    )
  }
  if (fk.onUpdate !== db.onUpdate) {
    drifts.push(
      drift('mismatch', object, `on update: model ${fk.onUpdate} vs db ${db.onUpdate}`),
    )
  }
  return drifts
}

function compareForeignKeys(model: ModelTable, dbFks: readonly DbConstraint[]): Drift[] {
  const drifts: Drift[] = []
  const dbByKey = new Map(dbFks.map((f) => [fkKey(f.columns, f.refTable ?? ''), f]))
  const modelKeys = new Set<string>()
  for (const fk of model.foreignKeys) {
    const key = fkKey(fk.columns, fk.refTable)
    modelKeys.add(key)
    const found = dbByKey.get(key)
    if (!found) {
      drifts.push(
        drift(
          'missing-in-db',
          `fk ${model.name}(${key})`,
          'declared in model, absent in db',
        ),
      )
    } else {
      drifts.push(...compareFkPair(model, fk, found))
    }
  }
  for (const [key, f] of dbByKey) {
    if (!modelKeys.has(key)) {
      drifts.push(
        drift(
          'extra-in-db',
          `fk ${f.name} on ${model.name}(${key})`,
          'present in db, absent in model',
        ),
      )
    }
  }
  return drifts
}

export function compareChecks(
  model: ModelTable,
  dbChecks: readonly DbConstraint[],
): Drift[] {
  const drifts: Drift[] = []
  const dbByName = new Map(dbChecks.map((c) => [c.name, c]))
  const modelNames = new Set(model.checks.map((c) => c.name))
  for (const chk of model.checks) {
    const found = dbByName.get(chk.name)
    if (!found) {
      drifts.push(
        drift(
          'missing-in-db',
          `check ${chk.name} on ${model.name}`,
          'declared in model, absent in db',
        ),
      )
    } else if (found.definition !== chk.expr && !isRegisteredAs(chk.name, 'check')) {
      drifts.push(
        drift(
          'mismatch',
          `check ${chk.name} on ${model.name}`,
          `model [${chk.expr}] vs db [${found.definition}]`,
        ),
      )
    }
  }
  for (const c of dbChecks) {
    if (!modelNames.has(c.name) && !isRegisteredAs(c.name, 'check')) {
      drifts.push(
        drift(
          'unregistered-db-object',
          `check ${c.name} on ${model.name}`,
          'db check with no model or register entry',
        ),
      )
    }
  }
  return drifts
}

function compareIndexPair(model: ModelTable, ix: ModelIndex, db: DbIndex): Drift[] {
  const object = `index ${ix.name} on ${model.name}`
  const drifts: Drift[] = []
  if (ix.unique !== db.unique) {
    drifts.push(
      drift('mismatch', object, `unique: model ${ix.unique} vs db ${db.unique}`),
    )
  }
  if (ix.columns.join(',') !== db.columns.join(',')) {
    drifts.push(
      drift('mismatch', object, `columns: model [${ix.columns}] vs db [${db.columns}]`),
    )
  }
  if (ix.predicate !== db.predicate) {
    drifts.push(
      drift(
        'mismatch',
        object,
        `predicate: model [${ix.predicate ?? '∅'}] vs db [${db.predicate ?? '∅'}]`,
      ),
    )
  }
  if (db.included.length > 0) {
    drifts.push(
      drift(
        'mismatch',
        object,
        `db INCLUDE columns [${db.included}] not expressible in drizzle 0.45`,
      ),
    )
  }
  return drifts
}

function compareIndexes(model: ModelTable, dbIndexes: readonly DbIndex[]): Drift[] {
  const drifts: Drift[] = []
  const dbByName = new Map(dbIndexes.map((i) => [i.name, i]))
  const modelNames = new Set(model.indexes.map((i) => i.name))
  for (const ix of model.indexes) {
    const found = dbByName.get(ix.name)
    if (!found) {
      drifts.push(
        drift(
          'missing-in-db',
          `index ${ix.name} on ${model.name}`,
          'declared in model, absent in db',
        ),
      )
    } else {
      drifts.push(...compareIndexPair(model, ix, found))
    }
  }
  for (const i of dbIndexes) {
    if (!modelNames.has(i.name) && !isRegistered(i.name)) {
      drifts.push(
        drift(
          'unregistered-db-object',
          `index ${i.name} on ${model.name}`,
          'db index with no model or register entry',
        ),
      )
    }
  }
  return drifts
}

function compareEnumColumns(model: ModelTable, catalog: Catalog): Drift[] {
  const drifts: Drift[] = []
  const seen = new Set<string>()
  for (const col of model.columns) {
    if (!col.enumName || seen.has(col.enumName)) continue
    seen.add(col.enumName)
    const dbLabels = catalog.enums.get(col.enumName)
    const object = `enum ${col.enumName}`
    if (!dbLabels) {
      drifts.push(drift('missing-in-db', object, 'model enum type absent in db'))
      continue
    }
    const modelLabels = [...(col.enumValues ?? [])].sort().join(',')
    if (modelLabels !== [...dbLabels].sort().join(',')) {
      drifts.push(
        drift(
          'mismatch',
          object,
          `labels: model [${modelLabels}] vs db [${[...dbLabels].sort()}]`,
        ),
      )
    }
  }
  return drifts
}

function isRegistered(name: string): boolean {
  return DB_ONLY_CONSTRUCTS.some((c) => c.name === name)
}

function isRegisteredAs(
  name: string,
  kind: (typeof DB_ONLY_CONSTRUCTS)[number]['kind'],
): boolean {
  return DB_ONLY_CONSTRUCTS.some(
    (construct) => construct.name === name && construct.kind === kind,
  )
}

function compareTable(model: ModelTable, catalog: Catalog): Drift[] {
  const dbColumns = catalog.columns.get(model.name) ?? []
  const constraints = catalog.constraints.filter((c) => c.table === model.name)
  const drifts = compareColumns(model, dbColumns)
  // The Better Auth schema track owns constraints/indexes on auth tables; the
  // mirror (schema/auth.ts) is verified columns-only.
  if (model.isAuth) return drifts
  drifts.push(
    ...comparePrimaryKey(
      model,
      constraints.find((c) => c.type === 'p'),
    ),
  )
  drifts.push(
    ...compareUniques(
      model,
      constraints.filter((c) => c.type === 'u'),
    ),
  )
  drifts.push(
    ...compareForeignKeys(
      model,
      constraints.filter((c) => c.type === 'f'),
    ),
  )
  drifts.push(
    ...compareChecks(
      model,
      constraints.filter((c) => c.type === 'c'),
    ),
  )
  drifts.push(
    ...compareIndexes(
      model,
      catalog.indexes.filter((i) => i.table === model.name),
    ),
  )
  drifts.push(...compareEnumColumns(model, catalog))
  return drifts
}

function compareTableSets(model: readonly ModelTable[], catalog: Catalog): Drift[] {
  const drifts: Drift[] = []
  const modelNames = new Set(model.map((t) => t.name))
  for (const t of model) {
    if (!catalog.tables.has(t.name)) {
      drifts.push(
        drift('missing-in-db', `table ${t.name}`, 'declared in model, absent in db'),
      )
    }
  }
  for (const name of catalog.tables) {
    if (!modelNames.has(name) && !TEST_INFRA_TABLES.has(name)) {
      drifts.push(drift('extra-in-db', `table ${name}`, 'present in db, absent in model'))
    }
  }
  return drifts
}

// ─── DB-only register verification (both directions) ────────────────

function registeredKindCatalog(
  kind: string,
  catalog: Catalog,
): ReadonlySet<string> | null {
  switch (kind) {
    case 'trigger':
      return catalog.triggers
    case 'function':
      return catalog.functions
    case 'expression-index':
    case 'partial-index':
    case 'index-direction':
    case 'index':
      return catalog.indexNames
    case 'check':
      return new Set(catalog.constraints.filter((c) => c.type === 'c').map((c) => c.name))
    case 'enum':
      return new Set(catalog.enums.keys())
    default:
      return null // 'other' entries are documentation-only
  }
}

function compareRegistered(catalog: Catalog): Drift[] {
  const drifts: Drift[] = []
  for (const construct of DB_ONLY_CONSTRUCTS) {
    const names = registeredKindCatalog(construct.kind, catalog)
    if (names && !names.has(construct.name)) {
      drifts.push(
        drift(
          'missing-registered-object',
          `${construct.kind} ${construct.name}`,
          `registered DB-only construct absent in db (source: ${construct.source})`,
        ),
      )
    }
  }
  return drifts
}

function compareUnregistered(model: readonly ModelTable[], catalog: Catalog): Drift[] {
  const drifts: Drift[] = []
  for (const name of catalog.triggers) {
    if (!isRegistered(name)) {
      drifts.push(
        drift(
          'unregistered-db-object',
          `trigger ${name}`,
          'trigger with no register entry',
        ),
      )
    }
  }
  for (const name of catalog.functions) {
    if (!isRegistered(name)) {
      drifts.push(
        drift(
          'unregistered-db-object',
          `function ${name}`,
          'function with no register entry',
        ),
      )
    }
  }
  const modelEnumTypes = new Set(
    model.flatMap((t) => t.columns.map((c) => c.enumName).filter(Boolean)),
  )
  for (const name of catalog.enums.keys()) {
    if (!modelEnumTypes.has(name) && !isRegistered(name)) {
      drifts.push(
        drift(
          'unregistered-db-object',
          `enum ${name}`,
          'enum type with no model column or register entry',
        ),
      )
    }
  }
  for (const view of [...catalog.views, ...catalog.matviews]) {
    if (!isRegistered(view)) {
      drifts.push(
        drift(
          'unregistered-db-object',
          `view ${view}`,
          'view/matview with no register entry',
        ),
      )
    }
  }
  return drifts
}

// ─── Journal continuity ─────────────────────────────────────────────

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

type JournalEntry = Readonly<{ idx: number; tag: string; when: number }>

function readJournal(): readonly JournalEntry[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- BQC-7.7 (owner: platform): repo-constant path (REPO_ROOT/drizzle/meta), no request input; CI/operator tool
  const raw = readFileSync(join(REPO_ROOT, 'drizzle', 'meta', '_journal.json'), 'utf8')
  return (JSON.parse(raw) as { entries: JournalEntry[] }).entries
}

function sqlFileHash(tag: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- BQC-7.7 (owner: platform): tag comes from the committed drizzle journal, not request input; CI/operator tool
  const sql = readFileSync(join(REPO_ROOT, 'drizzle', `${tag}.sql`), 'utf8')
  return createHash('sha256').update(sql).digest('hex')
}

function compareJournal(catalog: Catalog): Drift[] {
  const entries = readJournal()
  const drifts: Drift[] = []
  if (catalog.journal.length !== entries.length) {
    drifts.push(
      drift(
        'journal',
        'drizzle.__drizzle_migrations',
        `row count ${catalog.journal.length} vs journal entries ${entries.length}`,
      ),
    )
    return drifts
  }
  entries.forEach((entry, i) => {
    const row = catalog.journal[i]!
    if (row.createdAt !== entry.when) {
      drifts.push(
        drift(
          'journal',
          `migration ${entry.tag}`,
          `created_at ${row.createdAt} vs journal when ${entry.when}`,
        ),
      )
    }
    if (row.hash !== sqlFileHash(entry.tag)) {
      drifts.push(
        drift(
          'journal',
          `migration ${entry.tag}`,
          'db hash differs from sha256 of the SQL file on disk',
        ),
      )
    }
  })
  return drifts
}

// ─── Entry point ────────────────────────────────────────────────────

/**
 * Compare the full Drizzle model against the migrated database's catalog.
 * Returns every drift found; an empty array means semantic parity.
 */
export async function collectSchemaDrift(q: Queryable): Promise<readonly Drift[]> {
  const catalog = await fetchCatalog(q)
  const model = withGoogleImportExpandBridge(extractModel(), catalog)
  const drifts: Drift[] = [...compareTableSets(model, catalog)]
  for (const table of model) {
    if (catalog.tables.has(table.name)) {
      drifts.push(...compareTable(table, catalog))
    }
  }
  drifts.push(...compareRegistered(catalog))
  drifts.push(...compareUnregistered(model, catalog))
  drifts.push(...compareJournal(catalog))
  return drifts
}

export function formatDrifts(drifts: readonly Drift[]): string {
  return drifts.map((d) => `[${d.kind}] ${d.object} — ${d.detail}`).join('\n')
}
