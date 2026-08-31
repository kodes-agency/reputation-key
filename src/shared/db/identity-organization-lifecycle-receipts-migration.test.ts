import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationPath = 'drizzle/0168_identity_organization_lifecycle_receipts.sql'
const migration = readFileSync(migrationPath, 'utf8')

describe('Identity Organization lifecycle receipts migration', () => {
  it('installs one content-free Identity receipt per lineage revision and phase', () => {
    expect(migration).toContain('CREATE TABLE "identity_organization_lifecycle_receipts"')
    expect(migration).toContain(
      'PRIMARY KEY("closure_lineage_id","lifecycle_revision","phase")',
    )
    expect(migration).toContain("\"phase\" IN ('closing', 'purge_readiness', 'purge')")
    expect(migration).toContain("\"outcome\" IN ('complete', 'no_data')")
    expect(migration).toContain(
      'BEFORE UPDATE OR DELETE ON "identity_organization_lifecycle_receipts"',
    )
    expect(migration).toContain(
      'BEFORE TRUNCATE ON "identity_organization_lifecycle_receipts"',
    )
    expect(migration).not.toMatch(/payload|email|note|description/iu)
  })

  it('allows only a new, append-only, already-expired retrieval authority to repeat its state', () => {
    expect(migration).toContain('CREATE TABLE "organization_export_retrieval_issuances"')
    expect(migration).toContain(
      'UNIQUE INDEX "organization_export_retrieval_issuances_operation_idx"',
    )
    expect(migration).toContain(
      'UNIQUE INDEX "organization_export_retrieval_issuances_digest_idx"',
    )
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION "guard_organization_export_revision_v1"',
    )
    expect(migration).toContain('OLD."retrieval_expires_at" <= NEW."retrieval_issued_at"')
    expect(migration).toContain(
      'NEW."retrieval_operation_id" IS DISTINCT FROM OLD."retrieval_operation_id"',
    )
    expect(migration).toContain(
      'NEW."retrieval_token_digest" IS DISTINCT FROM OLD."retrieval_token_digest"',
    )
    expect(migration).toContain(
      'organization export retrieval issuance evidence is missing',
    )
    expect(migration).toContain(
      'organization export retrieval issuance was not co-committed',
    )
    expect(migration).toContain(
      'BEFORE UPDATE OR DELETE ON "organization_export_retrieval_issuances"',
    )
  })

  it('is the journaled successor to the response-target terminal migration', () => {
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
      entries: Array<{ idx: number; tag: string }>
    }
    const entry = journal.entries.find(({ idx }) => idx === 168)
    expect(entry).toEqual({
      idx: 168,
      version: '7',
      when: 1790352000039,
      tag: '0168_identity_organization_lifecycle_receipts',
      breakpoints: true,
    })
  })
})
