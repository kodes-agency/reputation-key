import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CONTRACTION_INVENTORY_COMMANDS,
  CONTRACTION_SCHEMA_MODULES,
  contractionCandidateTableNames,
  contractionCandidateTables,
  contractionInventoryCoverage,
  type ContractionInventoryCommand,
} from './contraction-inventory-registry'

const ROOT = process.cwd()

/**
 * The exact physical tables CNV-01 must inventory before any contraction
 * slice. Pinned literally so a new contraction candidate has to be added here
 * and given a command in the same change.
 */
const EXPECTED_CANDIDATE_TABLES = [
  'badge_awards',
  'badge_definition_versions',
  'badge_definitions',
  'feedback',
  'gbp_cache',
  'gbp_import_jobs',
  'gbp_import_legacy_history',
  'goal_progress',
  'goals',
  'leaderboard_entries',
  'leaderboard_snapshots',
  'legacy_import_control',
  'legacy_import_effect_leases',
  'organization_badge_enablements',
  'portal_group_members',
  'property_access_grants',
  'ratings',
  'recognition_activation_groups',
  'recognition_activations',
  'recognition_award_status_facts',
  'recognition_awards',
  'recognition_board_entries',
  'recognition_board_snapshots',
  'recognition_reconciliation_events',
  'scan_events',
  'staff_assignments',
  'team_memberships',
  'team_portal_group_scopes',
  'teams',
]

const candidates = contractionCandidateTables(CONTRACTION_SCHEMA_MODULES)

const tableInventoryCommand = (
  overrides: Partial<ContractionInventoryCommand> = {},
): ContractionInventoryCommand =>
  Object.freeze({
    packageScript: 'ops:report-legacy-goals',
    scriptPath: 'scripts/ops/report-legacy-goals.ts',
    kind: 'table_inventory',
    authority: 'GOA-01/CNV-01',
    summary: 'fixture',
    tables: ['goals', 'goal_progress'],
    ...overrides,
  })

describe('contraction inventory registry', () => {
  it('resolves the exact 29 contraction candidate tables from the data-fate authority', () => {
    expect(candidates).toHaveLength(29)
    expect(candidates.map(({ tableName }) => tableName).sort()).toEqual(
      EXPECTED_CANDIDATE_TABLES,
    )
    expect(
      candidates.every(
        ({ disposition }) =>
          disposition === 'bounded_contraction' || disposition === 'compatibility_read',
      ),
    ).toBe(true)
    expect(
      candidates.filter(({ disposition }) => disposition === 'compatibility_read').length,
    ).toBe(7)
    expect(contractionCandidateTableNames()).toEqual(EXPECTED_CANDIDATE_TABLES)
  })

  it('refuses to resolve a candidate whose schema module or export is missing', () => {
    const withoutTeam = Object.fromEntries(
      Object.entries(CONTRACTION_SCHEMA_MODULES).filter(
        ([file]) => file !== 'team.schema.ts',
      ),
    )
    const withoutTeamsExport = {
      ...CONTRACTION_SCHEMA_MODULES,
      'team.schema.ts': {},
    }

    expect(() => contractionCandidateTables(withoutTeam)).toThrow(
      'contraction_inventory_schema_module_missing',
    )
    expect(() => contractionCandidateTables(withoutTeamsExport)).toThrow(
      'contraction_inventory_table_export_missing',
    )
  })

  it('maps every candidate table to exactly one inventory command and claims nothing else', () => {
    const coverage = contractionInventoryCoverage(candidates)

    expect(coverage.uncoveredTables).toEqual([])
    expect(coverage.multiplyClaimedTables).toEqual([])
    expect(coverage.unclassifiedClaimedTables).toEqual([])
    expect(coverage.candidateCount).toBe(29)
    expect(coverage.coveredCount).toBe(29)
    expect(coverage.complete).toBe(true)
  })

  it('fails when a candidate has zero commands, two commands, or an unclassified claim', () => {
    const goals = tableInventoryCommand()

    expect(contractionInventoryCoverage([candidates[0]!], []).uncoveredTables).toEqual([
      candidates[0]!.tableName,
    ])
    expect(
      contractionInventoryCoverage(candidates, [...CONTRACTION_INVENTORY_COMMANDS, goals])
        .multiplyClaimedTables,
    ).toEqual(['goal_progress', 'goals'])
    expect(
      contractionInventoryCoverage(candidates, [
        ...CONTRACTION_INVENTORY_COMMANDS,
        tableInventoryCommand({
          packageScript: 'ops:report-legacy-reviews',
          tables: ['reviews'],
        }),
      ]).unclassifiedClaimedTables,
    ).toEqual(['reviews'])
    expect(
      contractionInventoryCoverage(candidates, [
        ...CONTRACTION_INVENTORY_COMMANDS,
        tableInventoryCommand({ tables: ['goals', 'goals'] }),
      ]).multiplyClaimedTables,
    ).toContain('goals')
  })

  it('keeps reference-scan commands out of the per-table coverage arithmetic', () => {
    const referenceScans = CONTRACTION_INVENTORY_COMMANDS.filter(
      ({ kind }) => kind === 'reference_scan',
    )

    expect(referenceScans.length).toBeGreaterThan(0)
    expect(referenceScans.every(({ tables }) => tables.length === 0)).toBe(true)
  })

  it('binds every registered command to a real script and a real package.json script', () => {
    const packageScripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
      .scripts as Record<string, string>

    expect(CONTRACTION_INVENTORY_COMMANDS.length).toBeGreaterThan(0)
    for (const command of CONTRACTION_INVENTORY_COMMANDS) {
      expect(command.packageScript, command.packageScript).toMatch(/^ops:report-[a-z-]+$/)
      expect(existsSync(join(ROOT, command.scriptPath)), command.scriptPath).toBe(true)
      expect(packageScripts[command.packageScript], command.packageScript).toBe(
        `tsx ${command.scriptPath}`,
      )
    }
    expect(
      new Set(CONTRACTION_INVENTORY_COMMANDS.map(({ packageScript }) => packageScript))
        .size,
    ).toBe(CONTRACTION_INVENTORY_COMMANDS.length)
  })

  it('proves every inventory command is read-only source with no apply or delete mode', () => {
    // CNV-01 hard rule: physical contraction stays blocked until one verified
    // release plus restore proof, so the evidence tooling must not be able to
    // mutate anything even by accident.
    for (const command of CONTRACTION_INVENTORY_COMMANDS) {
      const source = readFileSync(join(ROOT, command.scriptPath), 'utf8')
      expect(source, command.scriptPath).not.toMatch(
        /\b(?:DROP|DELETE|TRUNCATE|ALTER|UPDATE\s+(?!action)|INSERT)\b/u,
      )
      expect(source, command.scriptPath).not.toMatch(/--apply|'apply'|"apply"/u)
      expect(source, command.scriptPath).toContain('mutation: false')
    }
  })
})
