import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DATA_CELL_SUPPORTED_COUNTRY_CODES } from '#/shared/domain/data-cell-catalogue'

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/0140_single_us_beta_data_cell.sql'),
  'utf8',
)
const journal = JSON.parse(
  readFileSync(resolve(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'),
) as { entries: Array<{ idx: number; tag: string; when: number }> }

describe('0140 single-US beta Data Cell cutover control', () => {
  it('is expand-only and seeds a durable open fence without rewriting data', () => {
    expect(migration).toContain('CREATE TABLE "data_cell_topology_cutovers"')
    expect(migration).toContain("'single-us-beta-v3', 'open', 'properties', 'us', 3")
    expect(migration).not.toMatch(/\bUPDATE properties\b/u)
    expect(migration).not.toContain('DISABLE TRIGGER')
    expect(migration).not.toContain('single_us_credential_home_cutover')
  })

  it('stores exact Railway target binding and row-level credential resume progress', () => {
    expect(migration).toContain('"target_project_id" varchar(255)')
    expect(migration).toContain('"target_environment_id" varchar(255)')
    expect(migration).toContain('"credential_active_organization_id" varchar(255)')
    expect(migration).toContain('"credential_connection_checkpoint" uuid')
    expect(migration).toContain('"credential_connections_processed" bigint')
    expect(migration).toContain('data_cell_topology_cutovers_target_binding_valid')
    expect(migration).toContain('data_cell_topology_cutovers_checkpoint_valid')
  })

  it('keeps the database supported-country guard identical to catalogue policy v3', () => {
    const body = migration.match(
      /single_us_beta_supported_country_v3[\s\S]*?ARRAY\[([\s\S]*?)\]::text\[\]/u,
    )?.[1]
    expect(body).toBeDefined()
    const countries = [...body!.matchAll(/'([A-Z]{2})'/gu)].map((match) => match[1])
    expect(countries).toEqual(DATA_CELL_SUPPORTED_COUNTRY_CODES)
  })

  it.each([
    ['region_moves', 'state'],
    ['gbp_import_jobs', 'status'],
    ['legacy_import_effect_leases', 'state'],
    ['gbp_import_requests', 'status'],
    ['gbp_import_request_items', 'status'],
    ['authorization_execution_permits', 'state'],
    ['google_credential_source_operations', 'state'],
    ['credential_revoke_permits', 'state'],
    ['google_subject_authority_guards', 'state'],
    ['google_credential_broker_replay', 'state'],
    ['google_connections', 'credential_use_state'],
  ])('fences new nonterminal %s transitions by %s', (table, column) => {
    expect(migration).toContain(`ON ${table}`)
    expect(migration).toContain(`'${column}'`)
  })

  it('also fences retry outcomes and active subject-guard pointers', () => {
    expect(migration).toContain("'outcome_code', 'temporarily_unavailable'")
    expect(migration).toContain("'active_source_operation_id', '__not_null__'")
  })

  it('pins new credential-home facts to US policy 3 during and after cutover', () => {
    expect(migration).toContain('ON google_organization_credential_homes')
    expect(migration).toContain('guard_single_us_credential_home_v1')
    expect(migration).toContain("topology_state NOT IN ('fenced', 'completed')")
  })

  it('updates the Property guard without relaxing ordinary immutability', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION guard_property_data_cell_assignment_v1',
    )
    expect(migration).toContain(
      "current_setting('repkey.data_cell_topology_cutover', true)",
    )
    expect(migration).toContain("topology_state IN ('fenced', 'completed')")
    expect(migration).toContain('immutable outside an operator move')
  })

  it('owns monotonic journal slot 0140 after the combined 0139 closure', () => {
    const currentIndex = journal.entries.findIndex(
      (entry) => entry.tag === '0140_single_us_beta_data_cell',
    )
    const previousPrevious = journal.entries.at(currentIndex - 2)
    const previous = journal.entries.at(currentIndex - 1)
    const current = journal.entries.at(currentIndex)
    expect(currentIndex).toBeGreaterThanOrEqual(2)
    expect(previousPrevious).toMatchObject({ idx: 138 })
    expect(previous).toMatchObject({ idx: 139, tag: '0139_portal_metric_beta_closure' })
    expect(current).toMatchObject({ idx: 140, tag: '0140_single_us_beta_data_cell' })
    expect(previous!.when).toBeGreaterThan(previousPrevious!.when)
    expect(current!.when).toBeGreaterThan(previous!.when)
  })
})
