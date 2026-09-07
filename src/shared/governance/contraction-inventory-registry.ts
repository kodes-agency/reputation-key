/**
 * CNV-01 contraction-inventory coverage authority.
 *
 * Physical contraction is blocked until one verified release plus restore
 * proof. What is NOT blocked — and what the eventual external run depends on —
 * is the evidence: for every table the persisted-model authority classifies as
 * `bounded_contraction` or `compatibility_read`, an operator must be able to
 * run one named, read-only command that reports its exact row counts, its
 * foreign-key surface, and the blockers that keep it retained.
 *
 * Before this registry, coverage was a claim in a runbook. Twenty of the
 * twenty-six bounded_contraction tables had a command, none of the seven
 * compatibility_read tables did, and nothing failed when a table was added
 * without a tool. This module makes the mapping executable and exhaustive in
 * both directions:
 *
 * - a candidate table with zero commands is `uncoveredTables`;
 * - a candidate table claimed twice is `multiplyClaimedTables` (two tools
 *   producing two counts for one table is not evidence, it is ambiguity);
 * - a command claiming a table that is not a contraction candidate is
 *   `unclassifiedClaimedTables`, because an inventory tool must never quietly
 *   widen its blast radius to active authority data.
 *
 * The candidate set is derived from DATA_FATE_AUTHORITY rather than restated,
 * so a future table cannot be classified for contraction without failing this
 * registry until its tool exists.
 */

import {
  CONTRACTION_SCHEMA_MODULES,
  resolvePhysicalTableName,
  type SchemaModuleMap,
} from '#/shared/db/contraction-schema-modules'
import { DATA_FATE_AUTHORITY } from './data-fate-authority'

const CONTRACTION_DISPOSITIONS = Object.freeze([
  'bounded_contraction',
  'compatibility_read',
] as const)

export type ContractionDisposition = (typeof CONTRACTION_DISPOSITIONS)[number]

export {
  CONTRACTION_SCHEMA_MODULES,
  type SchemaModuleMap,
} from '#/shared/db/contraction-schema-modules'

export type ContractionCandidateTable = Readonly<{
  schemaFile: string
  exportName: string
  /** Physical PostgreSQL table name; the Drizzle export name is often different. */
  tableName: string
  disposition: ContractionDisposition
  authority: string
}>

/**
 * A command is either a per-table inventory (counts and foreign keys for a
 * fixed table set) or a cross-cutting reference scan that claims no table of
 * its own. Only the first kind participates in per-table coverage, so adding a
 * scanner can never be mistaken for covering a table.
 */
export type ContractionInventoryCommandKind = 'table_inventory' | 'reference_scan'

export type ContractionInventoryCommand = Readonly<{
  packageScript: string
  scriptPath: string
  kind: ContractionInventoryCommandKind
  authority: string
  summary: string
  tables: readonly string[]
}>

const command = <const Definition extends ContractionInventoryCommand>(
  definition: Definition,
) => Object.freeze(definition)

export const CONTRACTION_INVENTORY_COMMANDS = Object.freeze([
  command({
    packageScript: 'ops:report-compatibility-read-surfaces',
    scriptPath: 'scripts/ops/report-compatibility-read-surfaces.ts',
    kind: 'table_inventory',
    authority: 'GST-01/MET-01/GGL-01/POR-01/PPL-01/CNV-01',
    summary:
      'Every compatibility mirror still readable during replacement parity; inventory only, removal stays blocked.',
    tables: ['feedback', 'ratings', 'scan_events', 'portal_group_members'],
  }),
  command({
    packageScript: 'ops:report-non-fk-references',
    scriptPath: 'scripts/ops/report-non-fk-references.ts',
    kind: 'reference_scan',
    authority: 'CNV-01',
    summary:
      'Cross-cutting textual and jsonb reference scan; claims no table of its own because it reports referents, not inventories.',
    tables: [],
  }),
] satisfies ReadonlyArray<ContractionInventoryCommand>)

export type ContractionInventoryCoverage = Readonly<{
  candidateCount: number
  coveredCount: number
  uncoveredTables: readonly string[]
  multiplyClaimedTables: readonly string[]
  unclassifiedClaimedTables: readonly string[]
  complete: boolean
}>

function isContractionDisposition(value: string): value is ContractionDisposition {
  return (CONTRACTION_DISPOSITIONS as readonly string[]).includes(value)
}

/**
 * Resolves every contraction candidate row in the persisted-model authority to
 * its physical table name. Throws rather than skipping when a schema module or
 * export cannot be resolved: an unresolvable candidate must break the build,
 * not disappear from the coverage arithmetic.
 */
export function contractionCandidateTables(
  modules: SchemaModuleMap,
): readonly ContractionCandidateTable[] {
  return DATA_FATE_AUTHORITY.filter(({ disposition }) =>
    isContractionDisposition(disposition),
  ).map(({ schemaFile, exportName, disposition, authority }) => {
    return Object.freeze({
      schemaFile,
      exportName,
      tableName: resolvePhysicalTableName(modules, schemaFile, exportName),
      disposition: disposition as ContractionDisposition,
      authority,
    })
  })
}

/** Physical names of every contraction candidate, resolved from the schema. */
export function contractionCandidateTableNames(): readonly string[] {
  return contractionCandidateTables(CONTRACTION_SCHEMA_MODULES)
    .map(({ tableName }) => tableName)
    .sort()
}

const sorted = (values: Iterable<string>): readonly string[] => [...values].sort()

export function contractionInventoryCoverage(
  candidates: readonly ContractionCandidateTable[],
  commands: readonly ContractionInventoryCommand[] = CONTRACTION_INVENTORY_COMMANDS,
): ContractionInventoryCoverage {
  const candidateTables = new Set(candidates.map(({ tableName }) => tableName))
  const claimCounts = new Map<string, number>()
  for (const entry of commands) {
    if (entry.kind !== 'table_inventory') continue
    for (const tableName of entry.tables) {
      claimCounts.set(tableName, (claimCounts.get(tableName) ?? 0) + 1)
    }
  }

  const uncoveredTables = sorted(
    [...candidateTables].filter((tableName) => (claimCounts.get(tableName) ?? 0) === 0),
  )
  const multiplyClaimedTables = sorted(
    [...claimCounts].filter(([, count]) => count > 1).map(([tableName]) => tableName),
  )
  const unclassifiedClaimedTables = sorted(
    [...claimCounts.keys()].filter((tableName) => !candidateTables.has(tableName)),
  )

  return Object.freeze({
    candidateCount: candidateTables.size,
    coveredCount: candidateTables.size - uncoveredTables.length,
    uncoveredTables,
    multiplyClaimedTables,
    unclassifiedClaimedTables,
    complete:
      uncoveredTables.length === 0 &&
      multiplyClaimedTables.length === 0 &&
      unclassifiedClaimedTables.length === 0,
  })
}
