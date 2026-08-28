import { createHash } from 'node:crypto'
import { isSafeOpaqueIdentifier } from '#/shared/domain/safe-identifier'

/**
 * GGL-01/CNV-01 content-free contraction evidence for the legacy Google
 * import control row and its effect leases.
 *
 * `legacy_import_control` is the single-row-per-environment switch that closed
 * the v1 import path, and `legacy_import_effect_leases` fenced the workers that
 * still ran under it. Both are classified `bounded_contraction`: retained until
 * the closure is inventoried, exported, restore-proved and free of readers.
 *
 * The three GGL-01 compatibility mirrors in the same schema file
 * (`gbp_cache`, `gbp_import_jobs`, `gbp_import_legacy_history`) are deliberately
 * NOT part of this report. They are `compatibility_read`, reviewed separately,
 * and folding them in here would imply the import-control contraction decision
 * already covers them.
 *
 * The report carries fixed classifications, exact counts, foreign-key metadata,
 * blockers, the observation time and a fingerprint — never an operator id, a
 * worker id, or a closure reason.
 */
const legacyImportControlTable = <
  const Definition extends Readonly<{
    tableName: string
    dataClass: 'legacy_import_control_state' | 'legacy_import_effect_lease'
  }>,
>(
  definition: Definition,
) =>
  Object.freeze({
    ...definition,
    sourceContext: 'integration' as const,
    lifecycleOwner: 'integration' as const,
    dataFateDisposition: 'bounded_contraction' as const,
    authority: 'GGL-01/CNV-01' as const,
    contractionRequirement: 'export_restore_then_contract' as const,
  })

/**
 * Exact retained import-control table set; expansion requires data-fate review.
 * The compatibility mirrors in the same schema file are excluded by design.
 */
export const LEGACY_IMPORT_CONTROL_TABLES = Object.freeze([
  legacyImportControlTable({
    tableName: 'legacy_import_control',
    dataClass: 'legacy_import_control_state',
  }),
  legacyImportControlTable({
    tableName: 'legacy_import_effect_leases',
    dataClass: 'legacy_import_effect_lease',
  }),
] as const)

export type LegacyImportControlTableName =
  (typeof LEGACY_IMPORT_CONTROL_TABLES)[number]['tableName']

export type LegacyImportControlReferentialAction =
  'no_action' | 'restrict' | 'cascade' | 'set_null' | 'set_default'

export type LegacyImportControlForeignKey = Readonly<{
  constraintName: string
  sourceSchema: string
  sourceTable: string
  sourceColumns: readonly string[]
  targetSchema: string
  targetTable: string
  targetColumns: readonly string[]
  onDelete: LegacyImportControlReferentialAction
  /** Null means PostgreSQL applies SET NULL/DEFAULT to every source column. */
  onDeleteSetColumns: readonly string[] | null
  onUpdate: LegacyImportControlReferentialAction
  matchType: 'simple' | 'full' | 'partial'
  deferrable: boolean
  initiallyDeferred: boolean
  validated: boolean
}>

export type LegacyImportControlInventoryInput = Readonly<{
  /** The operator's explicit `--as-of` observation time. */
  evaluatedAt: Date
  tableRows: ReadonlyArray<
    Readonly<{ tableName: LegacyImportControlTableName; rowCount: number }>
  >
  foreignKeys: ReadonlyArray<LegacyImportControlForeignKey>
}>

type LegacyImportControlInventoryBlocker =
  | 'retained_rows_require_export_restore'
  | 'external_foreign_key_dependencies_require_disposition'
  | 'unvalidated_foreign_keys_require_repair'

export type LegacyImportControlInventoryReport = Readonly<{
  version: 'legacy-import-control-inventory-v1'
  evaluatedAt: string
  tableCount: number
  nonemptyTableCount: number
  totalRows: number
  tables: ReadonlyArray<
    Readonly<
      (typeof LEGACY_IMPORT_CONTROL_TABLES)[number] & {
        rowCount: number
      }
    >
  >
  foreignKeys: ReadonlyArray<LegacyImportControlForeignKey>
  externalInboundDependencies: ReadonlyArray<LegacyImportControlForeignKey>
  externalOutboundDependencies: ReadonlyArray<LegacyImportControlForeignKey>
  blockers: ReadonlyArray<LegacyImportControlInventoryBlocker>
  /** Mechanical precondition only; export/restore approval remains separate. */
  schemaContractionCandidate: boolean
  fingerprint: string
}>

const TABLE_NAMES = new Set<string>(
  LEGACY_IMPORT_CONTROL_TABLES.map(({ tableName }) => tableName),
)

function assertSafeCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('legacy_import_control_inventory_count_invalid')
  }
}

function isLegacyImportControlTable(schema: string, table: string): boolean {
  return schema === 'public' && TABLE_NAMES.has(table)
}

function sortForeignKeys(
  rows: readonly LegacyImportControlForeignKey[],
): LegacyImportControlForeignKey[] {
  const key = (row: LegacyImportControlForeignKey) =>
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

export function buildLegacyImportControlInventoryReport(
  input: LegacyImportControlInventoryInput,
): LegacyImportControlInventoryReport {
  if (!Number.isSafeInteger(input.evaluatedAt.getTime())) {
    throw new Error('legacy_import_control_inventory_time_invalid')
  }

  const counts = new Map<LegacyImportControlTableName, number>()
  for (const row of input.tableRows) {
    assertSafeCount(row.rowCount)
    if (!TABLE_NAMES.has(row.tableName) || counts.has(row.tableName)) {
      throw new Error('legacy_import_control_inventory_table_mismatch')
    }
    counts.set(row.tableName, row.rowCount)
  }
  if (counts.size !== LEGACY_IMPORT_CONTROL_TABLES.length) {
    throw new Error('legacy_import_control_inventory_table_mismatch')
  }
  for (const row of input.foreignKeys) {
    if (
      !isSafeOpaqueIdentifier(row.constraintName) ||
      !isSafeOpaqueIdentifier(row.sourceSchema) ||
      !isSafeOpaqueIdentifier(row.sourceTable) ||
      !isSafeOpaqueIdentifier(row.targetSchema) ||
      !isSafeOpaqueIdentifier(row.targetTable) ||
      row.sourceColumns.length === 0 ||
      row.sourceColumns.length !== row.targetColumns.length ||
      row.sourceColumns.some((column) => !isSafeOpaqueIdentifier(column)) ||
      row.targetColumns.some((column) => !isSafeOpaqueIdentifier(column)) ||
      (row.onDeleteSetColumns !== null &&
        ((row.onDelete !== 'set_null' && row.onDelete !== 'set_default') ||
          row.onDeleteSetColumns.length === 0 ||
          new Set(row.onDeleteSetColumns).size !== row.onDeleteSetColumns.length ||
          row.onDeleteSetColumns.some(
            (column) =>
              !isSafeOpaqueIdentifier(column) || !row.sourceColumns.includes(column),
          ))) ||
      (row.initiallyDeferred && !row.deferrable) ||
      (!isLegacyImportControlTable(row.sourceSchema, row.sourceTable) &&
        !isLegacyImportControlTable(row.targetSchema, row.targetTable))
    ) {
      throw new Error('legacy_import_control_inventory_foreign_key_invalid')
    }
  }

  const tables = LEGACY_IMPORT_CONTROL_TABLES.map((definition) => ({
    ...definition,
    rowCount: counts.get(definition.tableName)!,
  }))
  const totalRows = tables.reduce((total, { rowCount }) => total + rowCount, 0)
  if (!Number.isSafeInteger(totalRows)) {
    throw new Error('legacy_import_control_inventory_count_invalid')
  }
  const foreignKeys = sortForeignKeys(input.foreignKeys)
  const externalInboundDependencies = foreignKeys.filter(
    ({ sourceSchema, sourceTable, targetSchema, targetTable }) =>
      !isLegacyImportControlTable(sourceSchema, sourceTable) &&
      isLegacyImportControlTable(targetSchema, targetTable),
  )
  const externalOutboundDependencies = foreignKeys.filter(
    ({ sourceSchema, sourceTable, targetSchema, targetTable }) =>
      isLegacyImportControlTable(sourceSchema, sourceTable) &&
      !isLegacyImportControlTable(targetSchema, targetTable),
  )
  const blockers: LegacyImportControlInventoryBlocker[] = []
  if (totalRows > 0) blockers.push('retained_rows_require_export_restore')
  if (externalInboundDependencies.length > 0) {
    blockers.push('external_foreign_key_dependencies_require_disposition')
  }
  if (foreignKeys.some(({ validated }) => !validated)) {
    blockers.push('unvalidated_foreign_keys_require_repair')
  }

  const evidence = {
    version: 'legacy-import-control-inventory-v1' as const,
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

export function canonicalLegacyImportControlInventoryReport(
  report: LegacyImportControlInventoryReport,
): string {
  return JSON.stringify(report, null, 2)
}
