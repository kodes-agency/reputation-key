// LIF-01-T2 — pre-egress evidence migration contract.
//
// The migration widens the export control plane so a post-upload crash is
// recoverable. Two properties must survive any later edit: it stays
// expand-only, and `ready` stays unreachable from `generating`.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationPath = 'drizzle/0170_organization_export_pre_egress_evidence.sql'
const migration = readFileSync(migrationPath, 'utf8')

describe('Organization Export pre-egress evidence migration', () => {
  it('registers exactly one journal step 0170', () => {
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
      entries: Array<{ idx: number; tag: string }>
    }
    expect(journal.entries.filter(({ idx }) => idx === 170)).toEqual([
      {
        idx: 170,
        version: '7',
        when: 1790352000041,
        tag: '0170_organization_export_pre_egress_evidence',
        breakpoints: true,
      },
    ])
  })

  it('is expand-only: every dropped constraint is re-added under the same name', () => {
    expect(migration).not.toMatch(/DROP\s+COLUMN/iu)
    expect(migration).not.toMatch(/DROP\s+TABLE/iu)
    expect(migration).not.toMatch(/DELETE\s+FROM/iu)
    expect(migration).not.toMatch(/TRUNCATE/iu)

    const dropped = [...migration.matchAll(/DROP CONSTRAINT "([a-z0-9_]+)"/gu)].map(
      (match) => match[1]!,
    )
    const added = [...migration.matchAll(/ADD CONSTRAINT "([a-z0-9_]+)"/gu)].map(
      (match) => match[1]!,
    )
    expect(dropped).toEqual([
      'organization_export_state_valid',
      'organization_export_state_shape',
    ])
    for (const name of dropped) expect(added).toContain(name)
  })

  it('adds the egress_pending state carrying digests without upload confirmation', () => {
    expect(migration).toContain(
      'ALTER TABLE "organization_exports" ADD COLUMN "pre_egress_recorded_at"',
    )
    expect(migration).toContain(
      'ALTER TABLE "organization_exports" ADD COLUMN "egress_recovery_attempts"',
    )
    expect(migration).toContain("'egress_pending'")
    expect(migration).toContain(
      '"organization_exports"."state" = \'egress_pending\'\n        AND "organization_exports"."generation_lease_expires_at" IS NOT NULL',
    )
  })

  it('withdraws generating -> ready so no archive is published without pre-egress evidence', () => {
    expect(migration).toContain(
      "(OLD.\"state\" = 'generating' AND NEW.\"state\" IN ('generating', 'egress_pending', 'failed'))",
    )
    expect(migration).toContain(
      "(OLD.\"state\" = 'egress_pending' AND NEW.\"state\" IN ('egress_pending', 'ready', 'failed'))",
    )
    expect(migration).not.toContain(
      "(OLD.\"state\" = 'generating' AND NEW.\"state\" IN ('generating', 'ready', 'failed'))",
    )
  })

  it('keeps the pre-egress digests write-once and the recovery counter monotonic', () => {
    expect(migration).toContain(
      'OLD."pre_egress_recorded_at" IS NOT NULL AND NEW."pre_egress_recorded_at" IS DISTINCT FROM OLD."pre_egress_recorded_at"',
    )
    expect(migration).toContain('organization export immutable archive evidence changed')
    expect(migration).toContain(
      'NEW."egress_recovery_attempts" < OLD."egress_recovery_attempts"',
    )
  })

  it('treats a mid-egress export as an open export for the single-open-per-org rule', () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "organization_exports_one_open_per_org_idx"',
    )
    const predicate = migration.slice(
      migration.indexOf(
        'CREATE UNIQUE INDEX "organization_exports_one_open_per_org_idx"',
      ),
    )
    expect(predicate.slice(0, 400)).toContain("'egress_pending'")
  })

  it('records no export content, only control-plane evidence', () => {
    expect(migration).not.toMatch(/"email"|"reviewer_name"|"snippet"|"payload"/iu)
  })
})
