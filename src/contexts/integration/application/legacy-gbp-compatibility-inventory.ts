import { createHash } from 'node:crypto'

/**
 * GGL-01/CNV-01 provenance section for the three legacy Google import
 * compatibility mirrors.
 *
 * The cross-cutting compatibility-read inventory counts all seven mirrors. This
 * module owns the part only the Integration context can state: which physical
 * table each Drizzle export actually maps to, and which schema replaced it.
 * The mapping is the trap — `legacyGbpCache` is `gbp_cache` and
 * `legacyGbpImportJobs` is `gbp_import_jobs`, so a report or a migration keyed
 * on the export name touches nothing and reads as "already empty".
 *
 * The section is content-free: physical names, export names, the replacement
 * schema, counts, the observation time, and a fingerprint. It never reads a
 * place id, a cached provider payload, or an import initiator.
 */

const legacyGbpCompatibilityTable = <
  const Definition extends Readonly<{
    tableName: string
    drizzleExportName: string
    dataClass: 'legacy_provider_cache' | 'legacy_import_job' | 'legacy_import_history'
  }>,
>(
  definition: Definition,
) =>
  Object.freeze({
    ...definition,
    schemaFile: 'google-import-compatibility.schema.ts' as const,
    lifecycleOwner: 'integration' as const,
    dataFateDisposition: 'compatibility_read' as const,
    authority: 'GGL-01/CNV-01' as const,
    /** The governed model that replaced this mirror. */
    replacedBy: 'google-import-v2.schema.ts' as const,
    contractionRequirement: 'verified_release_and_restore_proof_then_review' as const,
  })

export const LEGACY_GBP_COMPATIBILITY_TABLES = Object.freeze([
  legacyGbpCompatibilityTable({
    tableName: 'gbp_cache',
    drizzleExportName: 'legacyGbpCache',
    dataClass: 'legacy_provider_cache',
  }),
  legacyGbpCompatibilityTable({
    tableName: 'gbp_import_jobs',
    drizzleExportName: 'legacyGbpImportJobs',
    dataClass: 'legacy_import_job',
  }),
  legacyGbpCompatibilityTable({
    tableName: 'gbp_import_legacy_history',
    drizzleExportName: 'gbpImportLegacyHistory',
    dataClass: 'legacy_import_history',
  }),
] as const)

export type LegacyGbpCompatibilityTableName =
  (typeof LEGACY_GBP_COMPATIBILITY_TABLES)[number]['tableName']

export type LegacyGbpCompatibilitySectionInput = Readonly<{
  /** The operator's explicit `--as-of` observation time. */
  evaluatedAt: Date
  tableRows: ReadonlyArray<
    Readonly<{ tableName: LegacyGbpCompatibilityTableName; rowCount: number }>
  >
}>

export type LegacyGbpCompatibilitySection = Readonly<{
  version: 'legacy-gbp-compatibility-section-v1'
  evaluatedAt: string
  tableCount: number
  totalRows: number
  tables: ReadonlyArray<
    Readonly<(typeof LEGACY_GBP_COMPATIBILITY_TABLES)[number] & { rowCount: number }>
  >
  /** Always false; the mirrors are blocked by the compatibility-read rule. */
  schemaContractionCandidate: false
  fingerprint: string
}>

const TABLE_NAMES = new Set<string>(
  LEGACY_GBP_COMPATIBILITY_TABLES.map(({ tableName }) => tableName),
)

export function buildLegacyGbpCompatibilitySection(
  input: LegacyGbpCompatibilitySectionInput,
): LegacyGbpCompatibilitySection {
  if (!Number.isSafeInteger(input.evaluatedAt.getTime())) {
    throw new Error('legacy_gbp_compatibility_time_invalid')
  }

  const counts = new Map<LegacyGbpCompatibilityTableName, number>()
  for (const row of input.tableRows) {
    if (!Number.isSafeInteger(row.rowCount) || row.rowCount < 0) {
      throw new Error('legacy_gbp_compatibility_count_invalid')
    }
    if (!TABLE_NAMES.has(row.tableName) || counts.has(row.tableName)) {
      throw new Error('legacy_gbp_compatibility_table_mismatch')
    }
    counts.set(row.tableName, row.rowCount)
  }
  if (counts.size !== LEGACY_GBP_COMPATIBILITY_TABLES.length) {
    throw new Error('legacy_gbp_compatibility_table_mismatch')
  }

  const tables = LEGACY_GBP_COMPATIBILITY_TABLES.map((definition) => ({
    ...definition,
    rowCount: counts.get(definition.tableName)!,
  }))
  const totalRows = tables.reduce((total, { rowCount }) => total + rowCount, 0)
  if (!Number.isSafeInteger(totalRows)) {
    throw new Error('legacy_gbp_compatibility_count_invalid')
  }

  const evidence = {
    version: 'legacy-gbp-compatibility-section-v1' as const,
    evaluatedAt: input.evaluatedAt.toISOString(),
    tableCount: tables.length,
    totalRows,
    tables,
    schemaContractionCandidate: false as const,
  }
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(evidence), 'utf8')
    .digest('hex')
  return Object.freeze({ ...evidence, fingerprint })
}
