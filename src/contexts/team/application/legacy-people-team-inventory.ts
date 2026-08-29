import { createHash } from 'node:crypto'
import { isSafeOpaqueIdentifier } from '#/shared/domain/safe-identifier'

const legacyPeopleTeamTable = <
  const Definition extends Readonly<{
    tableName: string
    sourceContext: 'staff' | 'team'
    lifecycleOwner: 'identity' | 'staff'
    dataClass:
      | 'legacy_property_access_grant'
      | 'legacy_combined_staff_assignment'
      | 'legacy_people_team'
      | 'legacy_team_membership'
      | 'legacy_team_portal_group_scope'
  }>,
>(
  definition: Definition,
) =>
  Object.freeze({
    ...definition,
    dataFateDisposition: 'bounded_contraction' as const,
    authority: 'PPL-01/CNV-01' as const,
    contractionRequirement: 'export_restore_then_contract' as const,
  })

/** Exact PPL-01/CNV-01 table set; expanding it requires data-fate review. */
export const LEGACY_PEOPLE_TEAM_TABLES = Object.freeze([
  legacyPeopleTeamTable({
    tableName: 'property_access_grants',
    sourceContext: 'staff',
    lifecycleOwner: 'identity',
    dataClass: 'legacy_property_access_grant',
  }),
  legacyPeopleTeamTable({
    tableName: 'staff_assignments',
    sourceContext: 'staff',
    lifecycleOwner: 'staff',
    dataClass: 'legacy_combined_staff_assignment',
  }),
  legacyPeopleTeamTable({
    tableName: 'teams',
    sourceContext: 'team',
    lifecycleOwner: 'staff',
    dataClass: 'legacy_people_team',
  }),
  legacyPeopleTeamTable({
    tableName: 'team_memberships',
    sourceContext: 'team',
    lifecycleOwner: 'staff',
    dataClass: 'legacy_team_membership',
  }),
  legacyPeopleTeamTable({
    tableName: 'team_portal_group_scopes',
    sourceContext: 'team',
    lifecycleOwner: 'staff',
    dataClass: 'legacy_team_portal_group_scope',
  }),
] as const)

export type LegacyPeopleTeamTableName =
  (typeof LEGACY_PEOPLE_TEAM_TABLES)[number]['tableName']

export type LegacyPeopleTeamForeignKey = Readonly<{
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

export type LegacyPeopleTeamInventoryInput = Readonly<{
  evaluatedAt: Date
  tableRows: ReadonlyArray<
    Readonly<{ tableName: LegacyPeopleTeamTableName; rowCount: number }>
  >
  foreignKeys: ReadonlyArray<LegacyPeopleTeamForeignKey>
}>

type InventoryBlocker =
  | 'retained_rows_require_export_restore'
  | 'external_foreign_key_dependencies_require_disposition'
  | 'unvalidated_foreign_keys_require_repair'

export type LegacyPeopleTeamInventoryReport = Readonly<{
  version: 'legacy-people-team-inventory-v2'
  evaluatedAt: string
  tableCount: number
  nonemptyTableCount: number
  totalRows: number
  tables: ReadonlyArray<
    Readonly<{
      tableName: LegacyPeopleTeamTableName
      sourceContext: 'staff' | 'team'
      lifecycleOwner: 'identity' | 'staff'
      dataClass:
        | 'legacy_property_access_grant'
        | 'legacy_combined_staff_assignment'
        | 'legacy_people_team'
        | 'legacy_team_membership'
        | 'legacy_team_portal_group_scope'
      dataFateDisposition: 'bounded_contraction'
      authority: 'PPL-01/CNV-01'
      contractionRequirement: 'export_restore_then_contract'
      rowCount: number
    }>
  >
  foreignKeys: ReadonlyArray<LegacyPeopleTeamForeignKey>
  externalInboundDependencies: ReadonlyArray<LegacyPeopleTeamForeignKey>
  externalOutboundDependencies: ReadonlyArray<LegacyPeopleTeamForeignKey>
  blockers: ReadonlyArray<InventoryBlocker>
  /** Mechanical precondition only; export/restore approval remains separate. */
  schemaContractionCandidate: boolean
  fingerprint: string
}>

const TABLE_NAMES = new Set<string>(
  LEGACY_PEOPLE_TEAM_TABLES.map(({ tableName }) => tableName),
)

function assertSafeCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('legacy_people_team_inventory_count_invalid')
  }
}

function sortForeignKeys(
  rows: readonly LegacyPeopleTeamForeignKey[],
): LegacyPeopleTeamForeignKey[] {
  const key = (row: LegacyPeopleTeamForeignKey) =>
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

function hasSafeIdentifiers(row: LegacyPeopleTeamForeignKey): boolean {
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

function hasPairedColumns(row: LegacyPeopleTeamForeignKey): boolean {
  return (
    row.sourceColumns.length > 0 && row.sourceColumns.length === row.targetColumns.length
  )
}

function touchesLegacyTable(row: LegacyPeopleTeamForeignKey): boolean {
  return (
    isLegacyTable(row.sourceSchema, row.sourceTable) ||
    isLegacyTable(row.targetSchema, row.targetTable)
  )
}

function assertForeignKeys(rows: readonly LegacyPeopleTeamForeignKey[]): void {
  for (const row of rows) {
    if (
      !hasSafeIdentifiers(row) ||
      !hasPairedColumns(row) ||
      (row.initiallyDeferred && !row.deferrable) ||
      !touchesLegacyTable(row)
    ) {
      throw new Error('legacy_people_team_inventory_foreign_key_invalid')
    }
  }
}

function countsByTable(
  tableRows: LegacyPeopleTeamInventoryInput['tableRows'],
): Map<LegacyPeopleTeamTableName, number> {
  const counts = new Map<LegacyPeopleTeamTableName, number>()
  for (const row of tableRows) {
    assertSafeCount(row.rowCount)
    if (!TABLE_NAMES.has(row.tableName) || counts.has(row.tableName)) {
      throw new Error('legacy_people_team_inventory_table_mismatch')
    }
    counts.set(row.tableName, row.rowCount)
  }
  if (counts.size !== LEGACY_PEOPLE_TEAM_TABLES.length) {
    throw new Error('legacy_people_team_inventory_table_mismatch')
  }
  return counts
}

export function buildLegacyPeopleTeamInventoryReport(
  input: LegacyPeopleTeamInventoryInput,
): LegacyPeopleTeamInventoryReport {
  if (!Number.isSafeInteger(input.evaluatedAt.getTime())) {
    throw new Error('legacy_people_team_inventory_time_invalid')
  }
  const counts = countsByTable(input.tableRows)

  const tables = LEGACY_PEOPLE_TEAM_TABLES.map((definition) => ({
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
    throw new Error('legacy_people_team_inventory_count_invalid')
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
    version: 'legacy-people-team-inventory-v2' as const,
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

export function canonicalLegacyPeopleTeamInventoryReport(
  report: LegacyPeopleTeamInventoryReport,
): string {
  return JSON.stringify(report, null, 2)
}
