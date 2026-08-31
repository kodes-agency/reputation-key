import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb, type Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { withPublicationAuthorizationFixtureMutation } from '#/shared/testing/reply-publication-authorization-fixtures'
import { createReviewOrganizationExportContributor } from './review-organization-export.adapter'

const ORG_ID = 'org-review-export-000000000000001'
const OTHER_ORG_ID = 'org-review-export-000000000000002'
const PROPERTY_ID = '5e000000-0000-4000-8000-000000000001'
const REVIEW_ID = '5e000000-0000-4000-8000-000000000002'
const INTERNAL_REPLY_ID = '5e000000-0000-4000-8000-000000000003'
const MIRRORED_REPLY_ID = '5e000000-0000-4000-8000-000000000004'
const ATTEMPT_ID = '5e000000-0000-4000-8000-000000000005'
const SNAPSHOT_RUN_ID = '5e000000-0000-4000-8000-000000000006'
const AT = new Date('2026-08-26T10:00:00.000Z')
const EXPIRES_AT = new Date('2027-08-26T10:00:00.000Z')
const DIGEST = 'a'.repeat(64)
const KEY_VERSION = 'review-export-test-v1'

/**
 * Every string here is provider-controlled or provider-identifying. Bullet 7
 * forbids all of it, so the test asserts none of these bytes reach the archive.
 */
const PROVIDER_STRINGS = [
  'GOOGLE_NEVER_EXPORT_EXTERNAL_ID',
  'GOOGLE_NEVER_EXPORT_LOCATION',
  'GOOGLE_NEVER_EXPORT_GUEST_TEXT',
  'GOOGLE_NEVER_EXPORT_TRANSLATED_TEXT',
  'GOOGLE_NEVER_EXPORT_REVIEWER_NAME',
  'GOOGLE_NEVER_EXPORT_OBSERVED_TEXT',
  'GOOGLE_NEVER_EXPORT_PROVIDER_REPLY',
  'GOOGLE_NEVER_EXPORT_MIRRORED_REPLY',
  'GOOGLE_NEVER_EXPORT_OPERATION_KEY',
  'GOOGLE_NEVER_EXPORT_CORRELATION_ID',
] as const

const MANAGER_REPLY_TEXT = 'Thank you for the feedback — we have retrained the team.'

const db: Database = getDb()
let pool: Pool

async function clean(): Promise<void> {
  for (const org of [ORG_ID, OTHER_ORG_ID]) {
    await pool.query(
      'DELETE FROM reply_publication_attempts WHERE organization_id = $1',
      [org],
    )
    await withPublicationAuthorizationFixtureMutation(() =>
      pool.query(
        'DELETE FROM reply_publication_authorizations WHERE organization_id = $1',
        [org],
      ),
    )
    await pool.query('DELETE FROM google_reply_observations WHERE organization_id = $1', [
      org,
    ])
    await pool.query('DELETE FROM replies WHERE organization_id = $1', [org])
    await pool.query(
      'DELETE FROM review_provider_snapshot_members WHERE run_id IN (SELECT id FROM review_provider_snapshot_runs WHERE organization_id = $1)',
      [org],
    )
    await pool.query('DELETE FROM review_provider_subjects WHERE organization_id = $1', [
      org,
    ])
    await pool.query(
      'DELETE FROM review_provider_snapshot_runs WHERE organization_id = $1',
      [org],
    )
    await pool.query(
      'DELETE FROM review_source_observations WHERE organization_id = $1',
      [org],
    )
    await pool.query('DELETE FROM review_source_contents WHERE organization_id = $1', [
      org,
    ])
    await pool.query('DELETE FROM material_review_revisions WHERE organization_id = $1', [
      org,
    ])
    await pool.query('DELETE FROM reviews WHERE organization_id = $1', [org])
    await pool.query('DELETE FROM properties WHERE organization_id = $1', [org])
  }
  await pool.query(
    'DELETE FROM review_provider_subject_hmac_key_versions WHERE key_version = $1',
    [KEY_VERSION],
  )
  await deleteTestOrganizations(pool, [ORG_ID, OTHER_ORG_ID])
}

/**
 * `review_provider_subject_one_active_idx` is a partial unique index on
 * `state = 'active'` with no tenant column, so at most one active key version
 * may exist in the whole database. Claiming it unconditionally made this file
 * fail with `Key (state)=(active) already exists` whenever another integration
 * file had already created one. The subject row below only needs a key version
 * that exists, so adopt the active singleton when it is already there and
 * create this file's own one only when the inventory is empty.
 */
async function activeSubjectKeyVersion(): Promise<string> {
  const active = await pool.query<{ key_version: string }>(
    `SELECT key_version FROM review_provider_subject_hmac_key_versions
     WHERE state = 'active'`,
  )
  const adopted = active.rows[0]?.key_version
  if (adopted !== undefined) return adopted
  await pool.query(
    `INSERT INTO review_provider_subject_hmac_key_versions (
       key_version, key_digest, state, generation, created_at, activated_at
     ) VALUES ($1, $2, 'active', 1, $3, $3)
     ON CONFLICT (key_version) DO NOTHING`,
    [KEY_VERSION, DIGEST, AT],
  )
  return KEY_VERSION
}

async function seedProviderSide(): Promise<void> {
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Review Export Test', 'review-export-0001', NOW())`,
    [ORG_ID],
  )
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Review Export Other', 'review-export-0002', NOW())`,
    [OTHER_ORG_ID],
  )
  await pool.query(
    `INSERT INTO properties (
       id, organization_id, name, slug, timezone, source_epoch, created_at, updated_at
     ) VALUES ($1, $2, 'Export Property', 'export-property', 'UTC', 0, NOW(), NOW())`,
    [PROPERTY_ID, ORG_ID],
  )
  await pool.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id,
       external_location_id, rating, reviewed_at, expires_at,
       source_epoch, source_revision, source_observation_sequence,
       analysis_sequence, ai_source_byte_length, ai_source_digest,
       source_content_state, created_at, updated_at
     ) VALUES ($1, $2, $3, 'google', $4, $5, 2, $6, $7, 0, 1, 1, 1, 1, $8,
               'active', $6, $6)`,
    [
      REVIEW_ID,
      ORG_ID,
      PROPERTY_ID,
      'GOOGLE_NEVER_EXPORT_EXTERNAL_ID',
      'GOOGLE_NEVER_EXPORT_LOCATION',
      AT,
      EXPIRES_AT,
      DIGEST,
    ],
  )
  await pool.query(
    `INSERT INTO material_review_revisions (
       review_id, revision, organization_id, property_id, source_epoch,
       normalization_version, source_digest, normalized_digest, rating,
       normalized_text, content_state, created_at, updated_at
     ) VALUES ($1, 1, $2, $3, 0, 'review-material-v1', $4, $4, 2, $5,
               'active', $6, $6)`,
    [REVIEW_ID, ORG_ID, PROPERTY_ID, DIGEST, 'GOOGLE_NEVER_EXPORT_GUEST_TEXT', AT],
  )
  await pool.query(
    `INSERT INTO review_source_contents (
       review_id, organization_id, property_id, platform, external_id,
       external_location_id, reviewer_name, rating, text, translated_text,
       language_code, reviewed_at, last_fetched_at, content_expires_at,
       source_epoch, source_revision, ai_source_byte_length, ai_source_digest,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 'google', $4, $5, $6, 2, $7, $8, 'en', $9, $9, $10,
               0, 1, 1, $11, $9, $9)`,
    [
      REVIEW_ID,
      ORG_ID,
      PROPERTY_ID,
      'GOOGLE_NEVER_EXPORT_EXTERNAL_ID',
      'GOOGLE_NEVER_EXPORT_LOCATION',
      'GOOGLE_NEVER_EXPORT_REVIEWER_NAME',
      'GOOGLE_NEVER_EXPORT_GUEST_TEXT',
      'GOOGLE_NEVER_EXPORT_TRANSLATED_TEXT',
      AT,
      EXPIRES_AT,
      DIGEST,
    ],
  )
  await pool.query(
    `INSERT INTO review_source_observations (
       review_id, observation_sequence, organization_id, property_id, source_epoch,
       observation_key, observation_digest, material_revision, observed_at,
       content_expires_at, normalization_version, source_digest, normalized_digest,
       comparison_result, rating,
       original_text, reviewer_name, reviewed_at, content_state, created_at, updated_at
     ) VALUES ($1, 1, $2, $3, 0, $4, $4, 1, $5, $6, 'review-material-v1', $4, $4,
               'unchanged', 2, $7, $8, $5, 'active', $5, $5)`,
    [
      REVIEW_ID,
      ORG_ID,
      PROPERTY_ID,
      DIGEST,
      AT,
      EXPIRES_AT,
      'GOOGLE_NEVER_EXPORT_OBSERVED_TEXT',
      'GOOGLE_NEVER_EXPORT_REVIEWER_NAME',
    ],
  )
  await pool.query(
    `INSERT INTO review_provider_snapshot_runs (
       id, organization_id, property_id, source_epoch, state, phase,
       started_at, expires_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 0, 'scanning', 'main', $4, $5, $4, $4)`,
    [SNAPSHOT_RUN_ID, ORG_ID, PROPERTY_ID, AT, EXPIRES_AT],
  )
  const keyVersion = await activeSubjectKeyVersion()
  await pool.query(
    `INSERT INTO review_provider_subjects (
       organization_id, property_id, source_epoch, key_version, locator_hmac,
       verifier_hmac, review_id, last_source_revision, state, last_observed_at,
       created_at, updated_at
     ) VALUES ($1, $2, 0, $6, decode($3, 'hex'), decode($3, 'hex'), $4, 1,
               'linked', $5, $5, $5)`,
    [ORG_ID, PROPERTY_ID, DIGEST, REVIEW_ID, AT, keyVersion],
  )
  await pool.query(
    `INSERT INTO review_provider_snapshot_members (run_id, review_id, main_seen)
     VALUES ($1, $2, true)`,
    [SNAPSHOT_RUN_ID, REVIEW_ID],
  )
}

async function seedManagerReplyWork(): Promise<void> {
  // A manager-authored, AI-assisted reply — this is what the export is for.
  await pool.query(
    `INSERT INTO replies (
       id, review_id, organization_id, text, reply_language_tag, status, source,
       created_by, approved_by, ai_generated, authorship, state_revision,
       origin_operation_id, origin_source_epoch, origin_source_revision,
       origin_base_reply_state_revision, origin_reply_drafting_epoch,
       origin_property_profile_version, origin_ai_profile_version,
       origin_concrete_language_tag, origin_template_group, ai_draft_expires_at,
       publication_state, publication_cycle, publication_attempts,
       submitted_at, approved_at, published_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'en-Latn-US', 'published', 'internal',
               'user-review-export-author', 'user-review-export-approver',
               true, 'ai_assisted', 1, $5, 0, 1, 0, 1, 1, 'reply-draft-v2',
               'en-Latn', 'en-Latn', $6, 'published', 1, 1, $7, $7, $7, $7, $7)`,
    [
      INTERNAL_REPLY_ID,
      REVIEW_ID,
      ORG_ID,
      MANAGER_REPLY_TEXT,
      randomUUID(),
      EXPIRES_AT,
      AT,
    ],
  )
  // A provider-mirrored reply. RepKey did not author this text.
  await pool.query(
    `INSERT INTO replies (
       id, review_id, organization_id, text, status, source, ai_generated,
       state_revision, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'published', 'google_sync', false, 1, $5, $5)`,
    [MIRRORED_REPLY_ID, REVIEW_ID, ORG_ID, 'GOOGLE_NEVER_EXPORT_MIRRORED_REPLY', AT],
  )
  await pool.query(
    `INSERT INTO reply_publication_authorizations (
       organization_id, property_id, review_id, reply_id, publication_cycle,
       source_epoch, material_review_revision, base_observation_revision,
       authorized_by_user_id, reply_state_revision, normalization_version,
       expected_reply_digest, authorized_at, created_at
     ) VALUES ($1, $2, $3, $4, 1, 0, 1, 0, 'user-review-export-approver', 1,
               'google-reply-v1', $5, $6, $6)`,
    [ORG_ID, PROPERTY_ID, REVIEW_ID, INTERNAL_REPLY_ID, DIGEST, AT],
  )
  await pool.query(
    `INSERT INTO reply_publication_attempts (
       id, organization_id, property_id, review_id, reply_id, publication_cycle,
       attempt_number, provider_operation_key, source_epoch,
       material_review_revision, reply_state_revision, base_observation_revision,
       normalization_version, expected_reply_digest, outcome,
       provider_correlation_id, provider_responded_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, 1, 1, $6, 0, 1, 1, 0, 'google-reply-v1',
               $7, 'provider_outcome_pending', $8, $9, $9, $9)`,
    [
      ATTEMPT_ID,
      ORG_ID,
      PROPERTY_ID,
      REVIEW_ID,
      INTERNAL_REPLY_ID,
      'GOOGLE_NEVER_EXPORT_OPERATION_KEY',
      DIGEST,
      'GOOGLE_NEVER_EXPORT_CORRELATION_ID',
      AT,
    ],
  )
  await pool.query(
    `INSERT INTO google_reply_observations (
       organization_id, property_id, review_id, observation_revision,
       observation_key, input_digest, source_epoch, material_review_revision,
       read_generation, state, change, resolution, source, provenance,
       normalized_text, normalization_version, normalized_digest,
       observed_at, content_expires_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 1, $4, $4, 0, 1, 1, 'live', 'added',
               'external_current_live', 'provider_snapshot', 'external_or_unknown',
               $5, 'google-reply-v1', $4, $6, $7, $6, $6)`,
    [
      ORG_ID,
      PROPERTY_ID,
      REVIEW_ID,
      DIGEST,
      'GOOGLE_NEVER_EXPORT_PROVIDER_REPLY',
      AT,
      EXPIRES_AT,
    ],
  )
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 4 })
  const client = await pool.connect()
  client.release()
})

afterAll(async () => {
  await clean()
  await pool.end()
})

beforeEach(async () => {
  await clean()
  await seedProviderSide()
})

describe.sequential('Review Organization Export contributor (PostgreSQL)', () => {
  it('exports manager-authored replies with AI provenance and no provider bytes', async () => {
    await seedManagerReplyWork()
    const contributor = createReviewOrganizationExportContributor(db)
    const asOf = new Date(Date.now() - 1000)

    const first = await contributor.contribute({
      organizationId: ORG_ID,
      requestId: randomUUID(),
      asOf,
    })
    const replay = await contributor.contribute({
      organizationId: ORG_ID,
      requestId: randomUUID(),
      asOf,
    })

    expect(first).toEqual(replay)
    expect(first.coverage).toBe('complete')
    expect(first.entries.map((entry) => entry.path)).toEqual([
      'review/replies.csv',
      'review/replies.json',
      'review/reply-authorizations.csv',
      'review/reply-authorizations.json',
      'review/reply-publication-attempts.csv',
      'review/reply-publication-attempts.json',
    ])
    expect(new Set(first.entries.map((entry) => entry.classification))).toEqual(
      new Set(['manager_authored']),
    )

    const archiveText = first.entries
      .map(({ bytes }) => Buffer.from(bytes).toString('utf8'))
      .join('\n')
    for (const provider of PROVIDER_STRINGS) {
      expect(archiveText).not.toContain(provider)
    }
    expect(archiveText).not.toContain(MIRRORED_REPLY_ID)
    expect(archiveText).toContain(MANAGER_REPLY_TEXT)

    const json = first.entries.find((entry) => entry.path === 'review/replies.json')!
    const payload = JSON.parse(Buffer.from(json.bytes).toString('utf8')) as {
      replies: readonly Record<string, unknown>[]
    }
    expect(payload.replies).toHaveLength(1)
    expect(payload.replies[0]).toMatchObject({
      id: INTERNAL_REPLY_ID,
      review_id: REVIEW_ID,
      status: 'published',
      source: 'internal',
      ai_generated: true,
      authorship: 'ai_assisted',
      origin_ai_profile_version: 'reply-draft-v2',
      origin_reply_drafting_epoch: 1,
      origin_property_profile_version: 1,
      origin_template_group: 'en-Latn',
    })

    const attempts = JSON.parse(
      Buffer.from(
        first.entries.find(
          (entry) => entry.path === 'review/reply-publication-attempts.json',
        )!.bytes,
      ).toString('utf8'),
    ) as { attempts: readonly Record<string, unknown>[] }
    expect(attempts.attempts).toHaveLength(1)
    expect(attempts.attempts[0]).toMatchObject({
      reply_id: INTERNAL_REPLY_ID,
      outcome: 'provider_outcome_pending',
    })
    expect(attempts.attempts[0]).not.toHaveProperty('provider_operation_key')
    expect(attempts.attempts[0]).not.toHaveProperty('provider_correlation_id')
    expect(attempts.attempts[0]).not.toHaveProperty('expected_reply_digest')
  })

  it('is tenant-fenced: another Organization sees none of this reply work', async () => {
    await seedManagerReplyWork()
    const contributor = createReviewOrganizationExportContributor(db)

    const contribution = await contributor.contribute({
      organizationId: OTHER_ORG_ID,
      requestId: randomUUID(),
      asOf: new Date(Date.now() - 1000),
    })

    expect(contribution).toEqual({
      context: 'review',
      coverage: 'no_data',
      omissionCodes: [],
      entries: [],
    })
  })

  it('answers no_data when only provider-mirrored reply rows exist', async () => {
    await pool.query(
      `INSERT INTO replies (
         id, review_id, organization_id, text, status, source, ai_generated,
         state_revision, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 'published', 'google_sync', false, 1, $5, $5)`,
      [MIRRORED_REPLY_ID, REVIEW_ID, ORG_ID, 'GOOGLE_NEVER_EXPORT_MIRRORED_REPLY', AT],
    )
    const contributor = createReviewOrganizationExportContributor(db)

    const contribution = await contributor.contribute({
      organizationId: ORG_ID,
      requestId: randomUUID(),
      asOf: new Date(Date.now() - 1000),
    })

    expect(contribution.coverage).toBe('no_data')
    expect(contribution.entries).toEqual([])
  })

  it('fails closed when a queued request is outside the bounded snapshot window', async () => {
    await seedManagerReplyWork()
    const contributor = createReviewOrganizationExportContributor(db)

    await expect(
      contributor.contribute({
        organizationId: ORG_ID,
        requestId: randomUUID(),
        asOf: new Date(Date.now() - 16 * 60 * 1000),
      }),
    ).rejects.toThrow(/snapshot window is unavailable/)
  })
})
