// LIF-01-T3 — shared context lifecycle receipts migration contract.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ORGANIZATION_LIFECYCLE_CONTEXTS } from '#/contexts/identity/domain/organization-lifecycle'

const migrationPath = 'drizzle/0171_context_organization_lifecycle_receipts.sql'
const migration = readFileSync(migrationPath, 'utf8')

describe('shared context Organization lifecycle receipts migration', () => {
  it('registers exactly one journal step 0171', () => {
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
      entries: Array<{ idx: number; tag: string }>
    }
    expect(journal.entries.filter(({ idx }) => idx === 171)).toEqual([
      {
        idx: 171,
        version: '7',
        when: 1790352000042,
        tag: '0171_context_organization_lifecycle_receipts',
        breakpoints: true,
      },
    ])
  })

  it('creates one receipt per context, lineage, revision and phase and nothing else', () => {
    expect(migration).toContain('CREATE TABLE "context_organization_lifecycle_receipts"')
    expect(migration).toContain(
      'PRIMARY KEY("context","closure_lineage_id","lifecycle_revision","phase")',
    )
    expect(migration).toContain("\"phase\" IN ('closing', 'purge_readiness', 'purge')")
    expect(migration).toContain("\"outcome\" IN ('complete', 'no_data')")
    for (const context of ORGANIZATION_LIFECYCLE_CONTEXTS) {
      expect(migration).toContain(`'${context}'`)
    }
  })

  it('is expand-only and content-free with no Organization foreign key', () => {
    expect(migration).not.toMatch(/DROP\s+(COLUMN|TABLE|CONSTRAINT|INDEX)/iu)
    expect(migration).not.toMatch(/ALTER TABLE "organization"/iu)
    expect(migration).not.toMatch(/REFERENCES/iu)
    expect(migration).not.toMatch(/payload|email|"note"|description/iu)
  })

  it('makes committed receipts append-only', () => {
    expect(migration).toContain(
      'CREATE FUNCTION "reject_context_lifecycle_receipt_mutation_v1"',
    )
    expect(migration).toContain(
      'BEFORE UPDATE OR DELETE ON "context_organization_lifecycle_receipts"',
    )
    expect(migration).toContain(
      'BEFORE TRUNCATE ON "context_organization_lifecycle_receipts"',
    )
    expect(migration).toContain(
      'REVOKE UPDATE, DELETE, TRUNCATE ON "context_organization_lifecycle_receipts" FROM PUBLIC',
    )
  })
})
