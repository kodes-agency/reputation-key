import { createHash } from 'node:crypto'
import { isSafeOpaqueIdentifier } from '#/shared/domain/safe-identifier'

const legacyGoalTable = <
  const Definition extends Readonly<{
    tableName: string
    dataClass: 'legacy_pre_beta_goal' | 'legacy_pre_beta_goal_progress'
  }>,
>(
  definition: Definition,
) =>
  Object.freeze({
    ...definition,
    sourceContext: 'goal' as const,
    lifecycleOwner: 'goal' as const,
    dataFateDisposition: 'bounded_contraction' as const,
    authority: 'GOA-01/CNV-01' as const,
    contractionRequirement: 'export_restore_then_contract' as const,
  })

/** Exact retained pre-beta Goal table set; expansion requires data-fate review. */
export const LEGACY_GOAL_TABLES = Object.freeze([
  legacyGoalTable({
    tableName: 'goals',
    dataClass: 'legacy_pre_beta_goal',
  }),
  legacyGoalTable({
    tableName: 'goal_progress',
    dataClass: 'legacy_pre_beta_goal_progress',
  }),
] as const)

export type LegacyGoalTableName = (typeof LEGACY_GOAL_TABLES)[number]['tableName']

export type LegacyGoalReferentialAction =
  'no_action' | 'restrict' | 'cascade' | 'set_null' | 'set_default'

export type LegacyGoalForeignKey = Readonly<{
  constraintName: string
  sourceSchema: string
  sourceTable: string
  sourceColumns: readonly string[]
  targetSchema: string
  targetTable: string
  targetColumns: readonly string[]
  onDelete: LegacyGoalReferentialAction
  /** Null means PostgreSQL applies SET NULL/DEFAULT to every source column. */
  onDeleteSetColumns: readonly string[] | null
  onUpdate: LegacyGoalReferentialAction
  matchType: 'simple' | 'full' | 'partial'
  deferrable: boolean
  initiallyDeferred: boolean
  validated: boolean
}>

export type LegacyGoalInventoryInput = Readonly<{
  evaluatedAt: Date
  tableRows: ReadonlyArray<Readonly<{ tableName: LegacyGoalTableName; rowCount: number }>>
  foreignKeys: ReadonlyArray<LegacyGoalForeignKey>
}>

type LegacyGoalInventoryBlocker =
  | 'retained_rows_require_export_restore'
  | 'external_foreign_key_dependencies_require_disposition'
  | 'unvalidated_foreign_keys_require_repair'

export type LegacyGoalInventoryReport = Readonly<{
  version: 'legacy-goal-inventory-v1'
  evaluatedAt: string
  tableCount: number
  nonemptyTableCount: number
  totalRows: number
  tables: ReadonlyArray<
    Readonly<
      (typeof LEGACY_GOAL_TABLES)[number] & {
        rowCount: number
      }
    >
  >
  foreignKeys: ReadonlyArray<LegacyGoalForeignKey>
  externalInboundDependencies: ReadonlyArray<LegacyGoalForeignKey>
  externalOutboundDependencies: ReadonlyArray<LegacyGoalForeignKey>
  blockers: ReadonlyArray<LegacyGoalInventoryBlocker>
  /** Mechanical precondition only; export/restore approval remains separate. */
  schemaContractionCandidate: boolean
  fingerprint: string
}>

const TABLE_NAMES = new Set<string>(LEGACY_GOAL_TABLES.map(({ tableName }) => tableName))

function assertSafeCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('legacy_goal_inventory_count_invalid')
  }
}

function isLegacyGoalTable(schema: string, table: string): boolean {
  return schema === 'public' && TABLE_NAMES.has(table)
}

function sortForeignKeys(rows: readonly LegacyGoalForeignKey[]): LegacyGoalForeignKey[] {
  const key = (row: LegacyGoalForeignKey) =>
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

export function buildLegacyGoalInventoryReport(
  input: LegacyGoalInventoryInput,
): LegacyGoalInventoryReport {
  if (!Number.isSafeInteger(input.evaluatedAt.getTime())) {
    throw new Error('legacy_goal_inventory_time_invalid')
  }

  const counts = new Map<LegacyGoalTableName, number>()
  for (const row of input.tableRows) {
    assertSafeCount(row.rowCount)
    if (!TABLE_NAMES.has(row.tableName) || counts.has(row.tableName)) {
      throw new Error('legacy_goal_inventory_table_mismatch')
    }
    counts.set(row.tableName, row.rowCount)
  }
  if (counts.size !== LEGACY_GOAL_TABLES.length) {
    throw new Error('legacy_goal_inventory_table_mismatch')
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
      (!isLegacyGoalTable(row.sourceSchema, row.sourceTable) &&
        !isLegacyGoalTable(row.targetSchema, row.targetTable))
    ) {
      throw new Error('legacy_goal_inventory_foreign_key_invalid')
    }
  }

  const tables = LEGACY_GOAL_TABLES.map((definition) => ({
    ...definition,
    rowCount: counts.get(definition.tableName)!,
  }))
  const totalRows = tables.reduce((total, { rowCount }) => total + rowCount, 0)
  if (!Number.isSafeInteger(totalRows)) {
    throw new Error('legacy_goal_inventory_count_invalid')
  }
  const foreignKeys = sortForeignKeys(input.foreignKeys)
  const externalInboundDependencies = foreignKeys.filter(
    ({ sourceSchema, sourceTable, targetSchema, targetTable }) =>
      !isLegacyGoalTable(sourceSchema, sourceTable) &&
      isLegacyGoalTable(targetSchema, targetTable),
  )
  const externalOutboundDependencies = foreignKeys.filter(
    ({ sourceSchema, sourceTable, targetSchema, targetTable }) =>
      isLegacyGoalTable(sourceSchema, sourceTable) &&
      !isLegacyGoalTable(targetSchema, targetTable),
  )
  const blockers: LegacyGoalInventoryBlocker[] = []
  if (totalRows > 0) blockers.push('retained_rows_require_export_restore')
  if (externalInboundDependencies.length > 0) {
    blockers.push('external_foreign_key_dependencies_require_disposition')
  }
  if (foreignKeys.some(({ validated }) => !validated)) {
    blockers.push('unvalidated_foreign_keys_require_repair')
  }

  const evidence = {
    version: 'legacy-goal-inventory-v1' as const,
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

export function canonicalLegacyGoalInventoryReport(
  report: LegacyGoalInventoryReport,
): string {
  return JSON.stringify(report, null, 2)
}
