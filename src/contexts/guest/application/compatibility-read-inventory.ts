import { createHash } from 'node:crypto'
import { isSafeOpaqueIdentifier } from '#/shared/domain/safe-identifier'

/**
 * CNV-01 content-free inventory of every `compatibility_read` mirror.
 *
 * Seven tables are still readable during replacement parity: the pre-beta guest
 * tables (`feedback`, `ratings`, `scan_events`), the legacy Google import
 * mirrors (`gbp_import_legacy_history`, `gbp_cache`, `gbp_import_jobs`) and the
 * pre-beta portal group membership mirror (`portal_group_members`).
 *
 * The hard rule blocks the DROP, not the inventory. Without an inventory there
 * is no evidence base from which the block could ever be lifted, so this module
 * reports what exists — counts, foreign keys, and how many production modules
 * still read each mirror — while `schemaContractionCandidate` stays false by
 * construction. A mirror may only be removed after one verified release plus a
 * restore proof, and neither of those is observable from a database snapshot.
 *
 * Three of the Drizzle exports do not match their physical table names
 * (`legacyGbpCache` → `gbp_cache`, `legacyGbpImportJobs` → `gbp_import_jobs`,
 * `gbpImportLegacyHistory` → `gbp_import_legacy_history`). The mapping is
 * recorded per row so a report keyed on the export name cannot silently
 * inventory nothing.
 */

const compatibilityReadTable = <
  const Definition extends Readonly<{
    tableName: string
    drizzleExportName: string
    sourceContext: 'guest' | 'integration' | 'portal'
    lifecycleOwner: 'guest' | 'integration' | 'portal'
    dataClass:
      | 'legacy_guest_interaction'
      | 'legacy_google_import_mirror'
      | 'legacy_portal_group_membership'
    authority: string
    /**
     * Repository-relative modules that still read this mirror in production
     * code. Every entry is verified to exist and to name the Drizzle export.
     */
    activeReaders: readonly string[]
  }>,
>(
  definition: Definition,
) =>
  Object.freeze({
    ...definition,
    dataFateDisposition: 'compatibility_read' as const,
    contractionRequirement: 'verified_release_and_restore_proof_then_review' as const,
    activeReaderCount: definition.activeReaders.length,
  })

/** Exact compatibility-mirror set; expansion requires data-fate review. */
export const COMPATIBILITY_READ_TABLES = Object.freeze([
  compatibilityReadTable({
    tableName: 'feedback',
    drizzleExportName: 'feedback',
    sourceContext: 'guest',
    lifecycleOwner: 'guest',
    dataClass: 'legacy_guest_interaction',
    authority: 'GST-01/MET-01/CNV-01',
    activeReaders: [
      'src/contexts/guest/infrastructure/repositories/guest-interaction.repository.ts',
      'src/contexts/guest/infrastructure/feedback-portal-attribution.ts',
    ],
  }),
  compatibilityReadTable({
    tableName: 'ratings',
    drizzleExportName: 'ratings',
    sourceContext: 'guest',
    lifecycleOwner: 'guest',
    dataClass: 'legacy_guest_interaction',
    authority: 'GST-01/MET-01/CNV-01',
    activeReaders: [
      'src/contexts/guest/infrastructure/repositories/guest-interaction.repository.ts',
    ],
  }),
  compatibilityReadTable({
    tableName: 'scan_events',
    drizzleExportName: 'scanEvents',
    sourceContext: 'guest',
    lifecycleOwner: 'guest',
    dataClass: 'legacy_guest_interaction',
    authority: 'GST-01/MET-01/CNV-01',
    activeReaders: [
      'src/contexts/guest/infrastructure/repositories/guest-interaction.repository.ts',
      'src/contexts/guest/infrastructure/guest-observation-store.ts',
    ],
  }),
  compatibilityReadTable({
    tableName: 'gbp_import_legacy_history',
    drizzleExportName: 'gbpImportLegacyHistory',
    sourceContext: 'integration',
    lifecycleOwner: 'integration',
    dataClass: 'legacy_google_import_mirror',
    authority: 'GGL-01/CNV-01',
    activeReaders: [],
  }),
  compatibilityReadTable({
    tableName: 'gbp_cache',
    drizzleExportName: 'legacyGbpCache',
    sourceContext: 'integration',
    lifecycleOwner: 'integration',
    dataClass: 'legacy_google_import_mirror',
    authority: 'GGL-01/CNV-01',
    activeReaders: [],
  }),
  compatibilityReadTable({
    tableName: 'gbp_import_jobs',
    drizzleExportName: 'legacyGbpImportJobs',
    sourceContext: 'integration',
    lifecycleOwner: 'integration',
    dataClass: 'legacy_google_import_mirror',
    authority: 'GGL-01/CNV-01',
    activeReaders: [],
  }),
  compatibilityReadTable({
    tableName: 'portal_group_members',
    drizzleExportName: 'portalGroupMembers',
    sourceContext: 'portal',
    lifecycleOwner: 'portal',
    dataClass: 'legacy_portal_group_membership',
    authority: 'POR-01/PPL-01/CNV-01',
    activeReaders: [
      'src/contexts/portal/infrastructure/repositories/portal.repository.ts',
    ],
  }),
] as const)

export type CompatibilityReadTableName =
  (typeof COMPATIBILITY_READ_TABLES)[number]['tableName']

export type CompatibilityReadReferentialAction =
  'no_action' | 'restrict' | 'cascade' | 'set_null' | 'set_default'

export type CompatibilityReadForeignKey = Readonly<{
  constraintName: string
  sourceSchema: string
  sourceTable: string
  sourceColumns: readonly string[]
  targetSchema: string
  targetTable: string
  targetColumns: readonly string[]
  onDelete: CompatibilityReadReferentialAction
  /** Null means PostgreSQL applies SET NULL/DEFAULT to every source column. */
  onDeleteSetColumns: readonly string[] | null
  onUpdate: CompatibilityReadReferentialAction
  matchType: 'simple' | 'full' | 'partial'
  deferrable: boolean
  initiallyDeferred: boolean
  validated: boolean
}>

export type CompatibilityReadInventoryInput = Readonly<{
  /** The operator's explicit `--as-of` observation time. */
  evaluatedAt: Date
  tableRows: ReadonlyArray<
    Readonly<{ tableName: CompatibilityReadTableName; rowCount: number }>
  >
  foreignKeys: ReadonlyArray<CompatibilityReadForeignKey>
}>

type CompatibilityReadBlocker =
  | 'compatibility_read_removal_requires_verified_release_and_restore_proof'
  | 'retained_rows_require_export_restore'
  | 'active_readers_require_replacement_parity'
  | 'external_foreign_key_dependencies_require_disposition'
  | 'unvalidated_foreign_keys_require_repair'

export type CompatibilityReadInventoryReport = Readonly<{
  version: 'compatibility-read-inventory-v1'
  evaluatedAt: string
  tableCount: number
  nonemptyTableCount: number
  totalRows: number
  activeReaderCount: number
  tables: ReadonlyArray<
    Readonly<
      (typeof COMPATIBILITY_READ_TABLES)[number] & {
        rowCount: number
      }
    >
  >
  foreignKeys: ReadonlyArray<CompatibilityReadForeignKey>
  externalInboundDependencies: ReadonlyArray<CompatibilityReadForeignKey>
  externalOutboundDependencies: ReadonlyArray<CompatibilityReadForeignKey>
  blockers: ReadonlyArray<CompatibilityReadBlocker>
  /** Always false while the disposition is compatibility_read. */
  schemaContractionCandidate: false
  fingerprint: string
}>

const TABLE_NAMES = new Set<string>(
  COMPATIBILITY_READ_TABLES.map(({ tableName }) => tableName),
)

function assertSafeCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('compatibility_read_inventory_count_invalid')
  }
}

function isCompatibilityReadTable(schema: string, table: string): boolean {
  return schema === 'public' && TABLE_NAMES.has(table)
}

function sortForeignKeys(
  rows: readonly CompatibilityReadForeignKey[],
): CompatibilityReadForeignKey[] {
  const key = (row: CompatibilityReadForeignKey) =>
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

function hasSafeIdentifiers(row: CompatibilityReadForeignKey): boolean {
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

function hasPairedColumns(row: CompatibilityReadForeignKey): boolean {
  return (
    row.sourceColumns.length > 0 && row.sourceColumns.length === row.targetColumns.length
  )
}

/** Null means PostgreSQL sets every source column, so no list to validate. */
function hasValidOnDeleteSetColumns(row: CompatibilityReadForeignKey): boolean {
  const setColumns = row.onDeleteSetColumns
  if (setColumns === null) return true
  return (
    (row.onDelete === 'set_null' || row.onDelete === 'set_default') &&
    setColumns.length > 0 &&
    new Set(setColumns).size === setColumns.length &&
    setColumns.every(
      (column) => isSafeOpaqueIdentifier(column) && row.sourceColumns.includes(column),
    )
  )
}

function touchesCompatibilityReadTable(row: CompatibilityReadForeignKey): boolean {
  return (
    isCompatibilityReadTable(row.sourceSchema, row.sourceTable) ||
    isCompatibilityReadTable(row.targetSchema, row.targetTable)
  )
}

function assertForeignKeys(rows: readonly CompatibilityReadForeignKey[]): void {
  for (const row of rows) {
    if (
      !hasSafeIdentifiers(row) ||
      !hasPairedColumns(row) ||
      !hasValidOnDeleteSetColumns(row) ||
      (row.initiallyDeferred && !row.deferrable) ||
      !touchesCompatibilityReadTable(row)
    ) {
      throw new Error('compatibility_read_inventory_foreign_key_invalid')
    }
  }
}

function countsByTable(
  tableRows: CompatibilityReadInventoryInput['tableRows'],
): Map<CompatibilityReadTableName, number> {
  const counts = new Map<CompatibilityReadTableName, number>()
  for (const row of tableRows) {
    assertSafeCount(row.rowCount)
    if (!TABLE_NAMES.has(row.tableName) || counts.has(row.tableName)) {
      throw new Error('compatibility_read_inventory_table_mismatch')
    }
    counts.set(row.tableName, row.rowCount)
  }
  if (counts.size !== COMPATIBILITY_READ_TABLES.length) {
    throw new Error('compatibility_read_inventory_table_mismatch')
  }
  return counts
}

export function buildCompatibilityReadInventoryReport(
  input: CompatibilityReadInventoryInput,
): CompatibilityReadInventoryReport {
  if (!Number.isSafeInteger(input.evaluatedAt.getTime())) {
    throw new Error('compatibility_read_inventory_time_invalid')
  }

  const counts = countsByTable(input.tableRows)
  assertForeignKeys(input.foreignKeys)

  const tables = COMPATIBILITY_READ_TABLES.map((definition) => ({
    ...definition,
    rowCount: counts.get(definition.tableName)!,
  }))
  const totalRows = tables.reduce((total, { rowCount }) => total + rowCount, 0)
  if (!Number.isSafeInteger(totalRows)) {
    throw new Error('compatibility_read_inventory_count_invalid')
  }
  const activeReaderCount = tables.reduce(
    (total, { activeReaderCount: readers }) => total + readers,
    0,
  )
  const foreignKeys = sortForeignKeys(input.foreignKeys)
  const externalInboundDependencies = foreignKeys.filter(
    ({ sourceSchema, sourceTable, targetSchema, targetTable }) =>
      !isCompatibilityReadTable(sourceSchema, sourceTable) &&
      isCompatibilityReadTable(targetSchema, targetTable),
  )
  const externalOutboundDependencies = foreignKeys.filter(
    ({ sourceSchema, sourceTable, targetSchema, targetTable }) =>
      isCompatibilityReadTable(sourceSchema, sourceTable) &&
      !isCompatibilityReadTable(targetSchema, targetTable),
  )

  // The first blocker is unconditional: it encodes the hard rule, not an
  // observation, so an empty database can never look removable.
  const blockers: CompatibilityReadBlocker[] = [
    'compatibility_read_removal_requires_verified_release_and_restore_proof',
  ]
  if (totalRows > 0) blockers.push('retained_rows_require_export_restore')
  if (activeReaderCount > 0) blockers.push('active_readers_require_replacement_parity')
  if (externalInboundDependencies.length > 0) {
    blockers.push('external_foreign_key_dependencies_require_disposition')
  }
  if (foreignKeys.some(({ validated }) => !validated)) {
    blockers.push('unvalidated_foreign_keys_require_repair')
  }

  const evidence = {
    version: 'compatibility-read-inventory-v1' as const,
    evaluatedAt: input.evaluatedAt.toISOString(),
    tableCount: tables.length,
    nonemptyTableCount: tables.filter(({ rowCount }) => rowCount > 0).length,
    totalRows,
    activeReaderCount,
    tables,
    foreignKeys,
    externalInboundDependencies,
    externalOutboundDependencies,
    blockers,
    schemaContractionCandidate: false as const,
  }
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(evidence), 'utf8')
    .digest('hex')
  return Object.freeze({ ...evidence, fingerprint })
}

export function canonicalCompatibilityReadInventoryReport(
  report: CompatibilityReadInventoryReport,
): string {
  return JSON.stringify(report, null, 2)
}
