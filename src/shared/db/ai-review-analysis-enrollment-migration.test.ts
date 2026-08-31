import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'drizzle/0137_ai_review_analysis_enrollment.sql'),
  'utf8',
)
const journal = JSON.parse(
  readFileSync(join(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'),
) as { entries: Array<{ idx: number; when: number; tag: string }> }

describe('0137 Review Analysis first-enablement migration', () => {
  it('owns the journal slot immediately after the validated Google checkpoint', () => {
    const google = journal.entries.find((entry) => entry.idx === 136)
    const enrollment = journal.entries.find((entry) => entry.idx === 137)

    expect(google?.tag).toBe('0136_google_import_discovery_checkpoint')
    expect(enrollment).toEqual(
      expect.objectContaining({
        idx: 137,
        when: 1790352000008,
        tag: '0137_ai_review_analysis_enrollment',
      }),
    )
    expect(enrollment!.when).toBeGreaterThan(google!.when)
  })

  it('adds exhaustive enrollment, exact membership, and replay lineage', () => {
    for (const table of [
      'ai_review_analysis_enrollments',
      'ai_review_analysis_enrollment_memberships',
      'ai_review_analysis_enrollment_replays',
    ]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`)
    }
    expect(migration).toContain(
      'ALTER TABLE "ai_review_analysis_backfill_run_memberships" ADD COLUMN "source_revision" bigint',
    )
    expect(migration).toContain('first_enablement_enrollment_v1')
  })

  it('creates referenced composite uniqueness before the tenant-scoped foreign keys', () => {
    const enrollmentScope = migration.indexOf(
      'CREATE UNIQUE INDEX "ai_review_analysis_enrollments_scope_unique"',
    )
    const enrollmentMembershipFk = migration.indexOf(
      'ADD CONSTRAINT "ai_review_enrollment_memberships_scope_fk"',
    )
    const consentScope = migration.indexOf(
      'CREATE UNIQUE INDEX "merchant_ai_consent_evidence_scope_unique"',
    )
    const authorizationFk = migration.indexOf(
      'ADD CONSTRAINT "ai_review_analysis_enrollments_authorization_fk"',
    )

    expect(enrollmentScope).toBeGreaterThan(-1)
    expect(enrollmentMembershipFk).toBeGreaterThan(enrollmentScope)
    expect(consentScope).toBeGreaterThan(-1)
    expect(authorizationFk).toBeGreaterThan(consentScope)
  })

  it('pins canonical empty evidence and guards every immutable authority', () => {
    expect(
      migration.match(
        /e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855/g,
      ),
    ).toHaveLength(6)
    for (const guard of [
      'guard_ai_review_analysis_enrollment_v1',
      'guard_ai_review_analysis_enrollment_membership_v1',
      'guard_ai_review_analysis_enrollment_replay_v1',
      'guard_ai_review_backfill_membership_v1',
    ]) {
      expect(migration).toContain(`CREATE OR REPLACE FUNCTION "${guard}"()`)
    }
    expect(migration).toContain('repkey.ai_review_enrollment_membership_writer')
    expect(migration).toContain('source_revision" IS NOT NULL')
  })

  it('replays every current active Review Analysis authorization after upgrade', () => {
    const begin = migration.indexOf('-- AI-02 CURRENT AUTHORIZATION REPLAY BEGIN')
    const eventInsert = migration.indexOf('INSERT INTO "outbox_events"', begin)
    const enabledFilter = migration.indexOf(
      'enablement."state" = \'enabled\'',
      eventInsert,
    )
    const capabilityFilter = migration.indexOf(
      'enablement."capabilities" @> ARRAY[\'review_analysis\']::text[]',
      eventInsert,
    )

    expect(begin).toBeGreaterThan(-1)
    expect(eventInsert).toBeGreaterThan(begin)
    expect(enabledFilter).toBeGreaterThan(eventInsert)
    expect(capabilityFilter).toBeGreaterThan(eventInsert)
    expect(migration).toContain("'identity.merchant_ai.changed'")
  })

  it('seeds exact durable enrollment authority before an upgraded worker is required', () => {
    const begin = migration.indexOf('-- AI-02 CURRENT ENROLLMENT SEED BEGIN')
    const lock = migration.indexOf('FOR UPDATE OF property', begin)
    const enrollment = migration.indexOf(
      'INSERT INTO "ai_review_analysis_enrollments"',
      begin,
    )
    const membership = migration.indexOf(
      'INSERT INTO "ai_review_analysis_enrollment_memberships"',
      enrollment,
    )
    const assertion = migration.indexOf(
      'AI-02 upgrade enrollment snapshot is inconsistent',
      membership,
    )
    const end = migration.indexOf('-- AI-02 CURRENT ENROLLMENT SEED END')

    expect(begin).toBeGreaterThan(-1)
    expect(lock).toBeGreaterThan(begin)
    expect(enrollment).toBeGreaterThan(lock)
    expect(membership).toBeGreaterThan(enrollment)
    expect(assertion).toBeGreaterThan(membership)
    expect(end).toBeGreaterThan(assertion)
    expect(migration).toContain('review."analysis_sequence" <=')
    expect(migration).toContain('review."source_revision" >= 1')
    expect(migration).toContain('review."ai_source_byte_length" <= 16384')
    expect(migration).toContain(') <= 65536')
  })
})
