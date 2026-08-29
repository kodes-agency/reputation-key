import { createHash } from 'node:crypto'
import { isSafeOpaqueIdentifier } from '#/shared/domain/safe-identifier'

const legacyRecognitionTable = <
  const Definition extends Readonly<{
    tableName: string
    sourceContext: 'badge' | 'leaderboard'
    dataClass:
      | 'legacy_competitive_badge'
      | 'legacy_competitive_leaderboard'
      | 'governed_recognition_experiment'
  }>,
>(
  definition: Definition,
) =>
  Object.freeze({
    ...definition,
    lifecycleOwner: 'staff' as const,
    dataFateDisposition: 'bounded_contraction' as const,
    authority: 'REC-01/CNV-01' as const,
    contractionRequirement: 'export_restore_then_contract' as const,
  })

export const LEGACY_RECOGNITION_TABLES = Object.freeze([
  legacyRecognitionTable({
    tableName: 'badge_definitions',
    sourceContext: 'badge',
    dataClass: 'legacy_competitive_badge',
  }),
  legacyRecognitionTable({
    tableName: 'organization_badge_enablements',
    sourceContext: 'badge',
    dataClass: 'legacy_competitive_badge',
  }),
  legacyRecognitionTable({
    tableName: 'badge_awards',
    sourceContext: 'badge',
    dataClass: 'legacy_competitive_badge',
  }),
  legacyRecognitionTable({
    tableName: 'badge_definition_versions',
    sourceContext: 'badge',
    dataClass: 'governed_recognition_experiment',
  }),
  legacyRecognitionTable({
    tableName: 'recognition_awards',
    sourceContext: 'badge',
    dataClass: 'governed_recognition_experiment',
  }),
  legacyRecognitionTable({
    tableName: 'recognition_award_status_facts',
    sourceContext: 'badge',
    dataClass: 'governed_recognition_experiment',
  }),
  legacyRecognitionTable({
    tableName: 'leaderboard_snapshots',
    sourceContext: 'leaderboard',
    dataClass: 'legacy_competitive_leaderboard',
  }),
  legacyRecognitionTable({
    tableName: 'leaderboard_entries',
    sourceContext: 'leaderboard',
    dataClass: 'legacy_competitive_leaderboard',
  }),
  legacyRecognitionTable({
    tableName: 'recognition_activations',
    sourceContext: 'leaderboard',
    dataClass: 'governed_recognition_experiment',
  }),
  legacyRecognitionTable({
    tableName: 'recognition_activation_groups',
    sourceContext: 'leaderboard',
    dataClass: 'governed_recognition_experiment',
  }),
  legacyRecognitionTable({
    tableName: 'recognition_board_snapshots',
    sourceContext: 'leaderboard',
    dataClass: 'governed_recognition_experiment',
  }),
  legacyRecognitionTable({
    tableName: 'recognition_board_entries',
    sourceContext: 'leaderboard',
    dataClass: 'governed_recognition_experiment',
  }),
  legacyRecognitionTable({
    tableName: 'recognition_reconciliation_events',
    sourceContext: 'leaderboard',
    dataClass: 'governed_recognition_experiment',
  }),
] as const)

export type LegacyRecognitionTableName =
  (typeof LEGACY_RECOGNITION_TABLES)[number]['tableName']

export type LegacyRecognitionForeignKey = Readonly<{
  constraintName: string
  sourceSchema: string
  sourceTable: string
  sourceColumns: readonly string[]
  targetSchema: string
  targetTable: string
  targetColumns: readonly string[]
  onDelete: 'no_action' | 'restrict' | 'cascade' | 'set_null' | 'set_default'
  onUpdate: 'no_action' | 'restrict' | 'cascade' | 'set_null' | 'set_default'
  matchType: 'simple' | 'full' | 'partial'
  deferrable: boolean
  initiallyDeferred: boolean
  validated: boolean
}>

export type LegacyRecognitionInventoryInput = Readonly<{
  evaluatedAt: Date
  tableRows: ReadonlyArray<
    Readonly<{ tableName: LegacyRecognitionTableName; rowCount: number }>
  >
  foreignKeys: ReadonlyArray<LegacyRecognitionForeignKey>
}>

type InventoryBlocker =
  | 'retained_rows_require_export_restore'
  | 'external_foreign_key_dependencies_require_disposition'
  | 'unvalidated_foreign_keys_require_repair'

export type LegacyRecognitionInventoryReport = Readonly<{
  version: 'legacy-recognition-inventory-v3'
  evaluatedAt: string
  tableCount: number
  nonemptyTableCount: number
  totalRows: number
  tables: ReadonlyArray<
    Readonly<{
      tableName: LegacyRecognitionTableName
      sourceContext: 'badge' | 'leaderboard'
      lifecycleOwner: 'staff'
      dataClass:
        | 'legacy_competitive_badge'
        | 'legacy_competitive_leaderboard'
        | 'governed_recognition_experiment'
      dataFateDisposition: 'bounded_contraction'
      authority: 'REC-01/CNV-01'
      contractionRequirement: 'export_restore_then_contract'
      rowCount: number
    }>
  >
  foreignKeys: ReadonlyArray<LegacyRecognitionForeignKey>
  externalInboundDependencies: ReadonlyArray<LegacyRecognitionForeignKey>
  externalOutboundDependencies: ReadonlyArray<LegacyRecognitionForeignKey>
  blockers: ReadonlyArray<InventoryBlocker>
  /** Candidate only; deletion still requires reviewed export/restore evidence. */
  schemaContractionCandidate: boolean
  fingerprint: string
}>

const TABLE_NAMES = new Set<string>(
  LEGACY_RECOGNITION_TABLES.map(({ tableName }) => tableName),
)

function assertSafeCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('legacy_recognition_inventory_count_invalid')
  }
}

function sortForeignKeys(
  rows: readonly LegacyRecognitionForeignKey[],
): LegacyRecognitionForeignKey[] {
  const key = (row: LegacyRecognitionForeignKey) =>
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

function isLegacyTable(schema: string, table: string): boolean {
  return schema === 'public' && TABLE_NAMES.has(table)
}

function hasSafeIdentifiers(row: LegacyRecognitionForeignKey): boolean {
  return (
    isSafeOpaqueIdentifier(row.constraintName) &&
    isSafeOpaqueIdentifier(row.sourceSchema) &&
    isSafeOpaqueIdentifier(row.sourceTable) &&
    isSafeOpaqueIdentifier(row.targetSchema) &&
    isSafeOpaqueIdentifier(row.targetTable) &&
    row.sourceColumns.every((column) => isSafeOpaqueIdentifier(column)) &&
    row.targetColumns.every((column) => isSafeOpaqueIdentifier(column))
  )
}

function hasPairedColumns(row: LegacyRecognitionForeignKey): boolean {
  return (
    row.sourceColumns.length > 0 && row.sourceColumns.length === row.targetColumns.length
  )
}

function touchesLegacyTable(row: LegacyRecognitionForeignKey): boolean {
  return (
    isLegacyTable(row.sourceSchema, row.sourceTable) ||
    isLegacyTable(row.targetSchema, row.targetTable)
  )
}

function assertForeignKeys(rows: readonly LegacyRecognitionForeignKey[]): void {
  for (const row of rows) {
    if (
      !hasSafeIdentifiers(row) ||
      !hasPairedColumns(row) ||
      (row.initiallyDeferred && !row.deferrable) ||
      !touchesLegacyTable(row)
    ) {
      throw new Error('legacy_recognition_inventory_foreign_key_invalid')
    }
  }
}

function countsByTable(
  tableRows: LegacyRecognitionInventoryInput['tableRows'],
): Map<LegacyRecognitionTableName, number> {
  const counts = new Map<LegacyRecognitionTableName, number>()
  for (const row of tableRows) {
    assertSafeCount(row.rowCount)
    if (!TABLE_NAMES.has(row.tableName) || counts.has(row.tableName)) {
      throw new Error('legacy_recognition_inventory_table_mismatch')
    }
    counts.set(row.tableName, row.rowCount)
  }
  if (counts.size !== LEGACY_RECOGNITION_TABLES.length) {
    throw new Error('legacy_recognition_inventory_table_mismatch')
  }
  return counts
}

export function buildLegacyRecognitionInventoryReport(
  input: LegacyRecognitionInventoryInput,
): LegacyRecognitionInventoryReport {
  if (!Number.isSafeInteger(input.evaluatedAt.getTime())) {
    throw new Error('legacy_recognition_inventory_time_invalid')
  }
  const counts = countsByTable(input.tableRows)

  const tables = LEGACY_RECOGNITION_TABLES.map((definition) => ({
    ...definition,
    rowCount: counts.get(definition.tableName)!,
  }))
  assertForeignKeys(input.foreignKeys)
  const foreignKeys = sortForeignKeys(input.foreignKeys)
  const externalInboundDependencies = foreignKeys.filter(
    ({ sourceSchema, sourceTable, targetSchema, targetTable }) =>
      !isLegacyTable(sourceSchema, sourceTable) &&
      isLegacyTable(targetSchema, targetTable),
  )
  const externalOutboundDependencies = foreignKeys.filter(
    ({ sourceSchema, sourceTable, targetSchema, targetTable }) =>
      isLegacyTable(sourceSchema, sourceTable) &&
      !isLegacyTable(targetSchema, targetTable),
  )
  const totalRows = tables.reduce((total, { rowCount }) => total + rowCount, 0)
  if (!Number.isSafeInteger(totalRows)) {
    throw new Error('legacy_recognition_inventory_count_invalid')
  }
  const blockers: InventoryBlocker[] = []
  if (totalRows > 0) blockers.push('retained_rows_require_export_restore')
  if (externalInboundDependencies.length > 0) {
    blockers.push('external_foreign_key_dependencies_require_disposition')
  }
  if (foreignKeys.some(({ validated }) => !validated)) {
    blockers.push('unvalidated_foreign_keys_require_repair')
  }

  const evidence = {
    version: 'legacy-recognition-inventory-v3' as const,
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

export function canonicalLegacyRecognitionInventoryReport(
  report: LegacyRecognitionInventoryReport,
): string {
  return JSON.stringify(report, null, 2)
}
