import { createHash } from 'node:crypto'
import { isSafeOpaqueIdentifier } from '#/shared/domain/safe-identifier'

/**
 * MET-01/CNV-01 content-free contraction evidence for the legacy Metric
 * rollup projections and their refresh watermark.
 *
 * The governed metric model reads `metric_readings` and its derived
 * aggregates; these four tables are the pre-beta incremental rollup path. They
 * are classified `bounded_contraction`, which means the rows may not be
 * dropped until they have been inventoried, exported, restore-proved, and
 * proved free of readers. This module produces the inventory half of that
 * evidence and nothing else: fixed classifications, exact counts, foreign-key
 * metadata, blockers, the observation time, and a fingerprint. It never reads
 * a metric key or an aggregate value, so the artifact can be attached to a
 * review record without carrying customer data.
 */

const legacyRollupTable = <
  const Definition extends Readonly<{
    tableName: string
    dataClass: 'legacy_rollup_projection' | 'legacy_rollup_refresh_watermark'
  }>,
>(
  definition: Definition,
) =>
  Object.freeze({
    ...definition,
    sourceContext: 'metric' as const,
    lifecycleOwner: 'metric' as const,
    dataFateDisposition: 'bounded_contraction' as const,
    authority: 'MET-01/CNV-01' as const,
    contractionRequirement: 'export_restore_then_contract' as const,
  })

/**
 * Exact retained rollup table set; expansion requires data-fate review.
 * `_rollup_watermarks` really does carry a leading underscore in PostgreSQL —
 * the Drizzle export is `rollupWatermarks`, and a hand-typed name loses it.
 */
export const LEGACY_ROLLUP_TABLES = Object.freeze([
  legacyRollupTable({
    tableName: 'rollup_daily_metrics',
    dataClass: 'legacy_rollup_projection',
  }),
  legacyRollupTable({
    tableName: 'rollup_weekly_metrics',
    dataClass: 'legacy_rollup_projection',
  }),
  legacyRollupTable({
    tableName: 'rollup_daily_inbox_metrics',
    dataClass: 'legacy_rollup_projection',
  }),
  legacyRollupTable({
    tableName: '_rollup_watermarks',
    dataClass: 'legacy_rollup_refresh_watermark',
  }),
] as const)

export type LegacyRollupTableName = (typeof LEGACY_ROLLUP_TABLES)[number]['tableName']

export type LegacyRollupReferentialAction =
  'no_action' | 'restrict' | 'cascade' | 'set_null' | 'set_default'

export type LegacyRollupForeignKey = Readonly<{
  constraintName: string
  sourceSchema: string
  sourceTable: string
  sourceColumns: readonly string[]
  targetSchema: string
  targetTable: string
  targetColumns: readonly string[]
  onDelete: LegacyRollupReferentialAction
  /** Null means PostgreSQL applies SET NULL/DEFAULT to every source column. */
  onDeleteSetColumns: readonly string[] | null
  onUpdate: LegacyRollupReferentialAction
  matchType: 'simple' | 'full' | 'partial'
  deferrable: boolean
  initiallyDeferred: boolean
  validated: boolean
}>

export type LegacyRollupInventoryInput = Readonly<{
  /** The operator's explicit `--as-of` observation time. */
  evaluatedAt: Date
  tableRows: ReadonlyArray<
    Readonly<{ tableName: LegacyRollupTableName; rowCount: number }>
  >
  foreignKeys: ReadonlyArray<LegacyRollupForeignKey>
}>

type LegacyRollupInventoryBlocker =
  | 'retained_rows_require_export_restore'
  | 'external_foreign_key_dependencies_require_disposition'
  | 'unvalidated_foreign_keys_require_repair'

export type LegacyRollupInventoryReport = Readonly<{
  version: 'legacy-rollup-inventory-v1'
  evaluatedAt: string
  tableCount: number
  nonemptyTableCount: number
  totalRows: number
  tables: ReadonlyArray<
    Readonly<
      (typeof LEGACY_ROLLUP_TABLES)[number] & {
        rowCount: number
      }
    >
  >
  foreignKeys: ReadonlyArray<LegacyRollupForeignKey>
  externalInboundDependencies: ReadonlyArray<LegacyRollupForeignKey>
  externalOutboundDependencies: ReadonlyArray<LegacyRollupForeignKey>
  blockers: ReadonlyArray<LegacyRollupInventoryBlocker>
  /** Mechanical precondition only; export/restore approval remains separate. */
  schemaContractionCandidate: boolean
  fingerprint: string
}>

const TABLE_NAMES = new Set<string>(
  LEGACY_ROLLUP_TABLES.map(({ tableName }) => tableName),
)

function assertSafeCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('legacy_rollup_inventory_count_invalid')
  }
}

function isLegacyRollupTable(schema: string, table: string): boolean {
  return schema === 'public' && TABLE_NAMES.has(table)
}

function sortForeignKeys(
  rows: readonly LegacyRollupForeignKey[],
): LegacyRollupForeignKey[] {
  const key = (row: LegacyRollupForeignKey) =>
    [
      row.sourceSchema,
      row.sourceTable,
      row.targetSchema,
      row.targetTable,
      row.constraintName,
    ].join('\0')
  return [...rows].sort((left, right) => {
    const leftKey = key(left)
    const rightKey = key(right)
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
  })
}

/** Any identifier in the constraint that is not transport/log safe. */
function hasUnsafeIdentifier(row: LegacyRollupForeignKey): boolean {
  return (
    !isSafeOpaqueIdentifier(row.constraintName) ||
    !isSafeOpaqueIdentifier(row.sourceSchema) ||
    !isSafeOpaqueIdentifier(row.sourceTable) ||
    !isSafeOpaqueIdentifier(row.targetSchema) ||
    !isSafeOpaqueIdentifier(row.targetTable) ||
    row.sourceColumns.some((column) => !isSafeOpaqueIdentifier(column)) ||
    row.targetColumns.some((column) => !isSafeOpaqueIdentifier(column))
  )
}

/** A constraint must map at least one source column onto exactly one target. */
function hasMismatchedColumnArity(row: LegacyRollupForeignKey): boolean {
  return (
    row.sourceColumns.length === 0 ||
    row.sourceColumns.length !== row.targetColumns.length
  )
}

/**
 * `onDeleteSetColumns` is only meaningful for SET NULL/DEFAULT, and every
 * listed column must be a distinct, safe source column.
 */
function hasInvalidOnDeleteSetColumns(row: LegacyRollupForeignKey): boolean {
  const setColumns = row.onDeleteSetColumns
  if (setColumns === null) return false
  return (
    (row.onDelete !== 'set_null' && row.onDelete !== 'set_default') ||
    setColumns.length === 0 ||
    new Set(setColumns).size !== setColumns.length ||
    setColumns.some(
      (column) => !isSafeOpaqueIdentifier(column) || !row.sourceColumns.includes(column),
    )
  )
}

/** True when neither end of the constraint touches a retained rollup table. */
function isUnrelatedToLegacyRollup(row: LegacyRollupForeignKey): boolean {
  return (
    !isLegacyRollupTable(row.sourceSchema, row.sourceTable) &&
    !isLegacyRollupTable(row.targetSchema, row.targetTable)
  )
}

function isInvalidLegacyRollupForeignKey(row: LegacyRollupForeignKey): boolean {
  return (
    hasUnsafeIdentifier(row) ||
    hasMismatchedColumnArity(row) ||
    hasInvalidOnDeleteSetColumns(row) ||
    (row.initiallyDeferred && !row.deferrable) ||
    isUnrelatedToLegacyRollup(row)
  )
}

export function buildLegacyRollupInventoryReport(
  input: LegacyRollupInventoryInput,
): LegacyRollupInventoryReport {
  if (!Number.isSafeInteger(input.evaluatedAt.getTime())) {
    throw new Error('legacy_rollup_inventory_time_invalid')
  }

  const counts = new Map<LegacyRollupTableName, number>()
  for (const row of input.tableRows) {
    assertSafeCount(row.rowCount)
    if (!TABLE_NAMES.has(row.tableName) || counts.has(row.tableName)) {
      throw new Error('legacy_rollup_inventory_table_mismatch')
    }
    counts.set(row.tableName, row.rowCount)
  }
  if (counts.size !== LEGACY_ROLLUP_TABLES.length) {
    throw new Error('legacy_rollup_inventory_table_mismatch')
  }
  for (const row of input.foreignKeys) {
    if (isInvalidLegacyRollupForeignKey(row)) {
      throw new Error('legacy_rollup_inventory_foreign_key_invalid')
    }
  }

  const tables = LEGACY_ROLLUP_TABLES.map((definition) => ({
    ...definition,
    rowCount: counts.get(definition.tableName)!,
  }))
  const totalRows = tables.reduce((total, { rowCount }) => total + rowCount, 0)
  if (!Number.isSafeInteger(totalRows)) {
    throw new Error('legacy_rollup_inventory_count_invalid')
  }
  const foreignKeys = sortForeignKeys(input.foreignKeys)
  const externalInboundDependencies = foreignKeys.filter(
    ({ sourceSchema, sourceTable, targetSchema, targetTable }) =>
      !isLegacyRollupTable(sourceSchema, sourceTable) &&
      isLegacyRollupTable(targetSchema, targetTable),
  )
  const externalOutboundDependencies = foreignKeys.filter(
    ({ sourceSchema, sourceTable, targetSchema, targetTable }) =>
      isLegacyRollupTable(sourceSchema, sourceTable) &&
      !isLegacyRollupTable(targetSchema, targetTable),
  )
  const blockers: LegacyRollupInventoryBlocker[] = []
  if (totalRows > 0) blockers.push('retained_rows_require_export_restore')
  if (externalInboundDependencies.length > 0) {
    blockers.push('external_foreign_key_dependencies_require_disposition')
  }
  if (foreignKeys.some(({ validated }) => !validated)) {
    blockers.push('unvalidated_foreign_keys_require_repair')
  }

  const evidence = {
    version: 'legacy-rollup-inventory-v1' as const,
    evaluatedAt: input.evaluatedAt.toISOString(),
    tableCount: tables.length,
    nonemptyTableCount: tables.filter(({ rowCount }) => rowCount > 0).length,
    totalRows,
    tables,
    foreignKeys,
    externalInboundDependencies,
    externalOutboundDependencies,
    blockers,
    schemaContractionCandidate: blockers.length === 0,
  }
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(evidence), 'utf8')
    .digest('hex')
  return Object.freeze({ ...evidence, fingerprint })
}

export function canonicalLegacyRollupInventoryReport(
  report: LegacyRollupInventoryReport,
): string {
  return JSON.stringify(report, null, 2)
}
