import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'drizzle/0136_google_import_discovery_checkpoint.sql'),
  'utf8',
)

describe('0136 durable Google import discovery migration', () => {
  it('adds normalized discovery records and short-lived invalidation fences', () => {
    expect(migration).toContain('CREATE TABLE "google_import_discovery_records"')
    expect(migration).toContain('CREATE TABLE "google_import_discovery_invalidations"')
    expect(migration).toContain('google_import_discovery_records_expiry_idx')
    expect(migration).toContain('google_import_discovery_invalidations_expiry_idx')
    expect(migration).toContain("interval '24 hours'")
    expect(migration).toContain("interval '00:00:30'")
  })

  it('keeps provider content tenant-bound and excludes unrelated schema changes', () => {
    expect(migration).toContain('google_import_discovery_records_connection_tenant_fk')
    expect(migration).toContain('google_import_discovery_records_property_tenant_fk')
    expect(migration).not.toMatch(/ALTER TABLE "portal_/u)
    expect(migration).not.toMatch(/ai_review_analysis_enrollment/iu)
  })
})
