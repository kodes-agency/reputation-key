// The AI part of the Organization export through the rights command, against
// real PostgreSQL: two Organizations, each with a served, a retired-generation
// and an expired analysis. Only the served ones leave, as allowlisted columns.

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import {
  recordingJournalStore,
  RIGHTS_FIXTURE_AT,
  rightsPlan,
  seedRightsOrganization,
  type RightsQuery,
} from '#/shared/db/testing/rights-isolation-fixture'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { createRightsJournal } from '#/shared/ops/rights/rights-journal'
import { runRightsExecutors } from '#/shared/ops/rights/rights-executor'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createAiRightsExecutor } from './ai-rights.adapter'

const NOW = new Date('2026-09-01T00:00:00.000Z')
const FUTURE = new Date('2027-08-01T00:00:00.000Z')
const PAST = new Date('2026-08-15T00:00:00.000Z')
const hex64 = () => randomUUID().replaceAll('-', '').repeat(2)

type Kind = 'served' | 'retired' | 'expired'

describe.sequential('AI Organization export through the rights command', () => {
  let lease: TestLease
  let db: Database
  let query: RightsQuery
  let userId: string
  const organizations: string[] = []

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 3)
    db = drizzle(lease.pool) as Database
    query = (text, params) => lease.pool.query(text, params)
    userId = `ai-export-user-${randomUUID()}`
    await query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, 'Export Manager', $2, true, $3, $3)`,
      [userId, `${userId}@example.test`, RIGHTS_FIXTURE_AT],
    )
  })

  afterEach(async () => {
    for (const organizationId of organizations) {
      await query('DELETE FROM properties WHERE organization_id = $1', [organizationId])
      await query('DELETE FROM google_connections WHERE organization_id = $1', [
        organizationId,
      ])
      await query('DELETE FROM outbox_events WHERE organization_id = $1', [
        organizationId,
      ])
    }
    await executeWithLastOwnerGuardDisabled(
      db,
      organizations.map((id) => sql`DELETE FROM member WHERE "organizationId" = ${id}`),
    )
    await deleteTestOrganizations(lease.pool, organizations)
    organizations.length = 0
  })

  afterAll(async () => {
    await query('DELETE FROM "user" WHERE id = $1', [userId])
    await lease.release()
  })

  async function heads() {
    const result = await query(
      `SELECT scope_key, control_id, generation FROM ai_execution_control_heads
       WHERE scope_key IN ('global', 'provider:private-beta-global-v2',
                           'capability:review_analysis')`,
    )
    const byScope = new Map(result.rows.map((row) => [row.scope_key as string, row]))
    return (scope: string) => {
      const head = byScope.get(scope)!
      return [head.control_id, Number(head.generation)] as const
    }
  }

  async function seedProperty(organizationId: string, propertyId: string) {
    const lineageId = randomUUID()
    const connectionId = randomUUID()
    await query(
      `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
       VALUES ($1, $2, $3, 'owner', now()) ON CONFLICT DO NOTHING`,
      [`ai-export-member-${organizationId}`, userId, organizationId],
    )
    await query(
      `INSERT INTO google_connections (
         id, organization_id, google_subject, encrypted_access_token,
         encrypted_refresh_token, token_expires_at, scopes, connected_by,
         visibility, status
       ) VALUES ($1, $2, $3, 'encrypted-access', 'encrypted-refresh',
                 now() + interval '1 hour',
                 ARRAY['https://www.googleapis.com/auth/business.manage'], $4,
                 'organization', 'active')`,
      [connectionId, organizationId, `subject-${connectionId}`, userId],
    )
    await query(
      `UPDATE properties SET lifecycle_state = 'active', google_connection_id = $3,
         gbp_account_id = 'account-ai-export', gbp_location_id = 'location-' || $2::text,
         google_binding_state = 'active', profile_source = 'legacy', source_epoch = 0
       WHERE organization_id = $1 AND id = $2::uuid`,
      [organizationId, propertyId, connectionId],
    )
    await query(
      `INSERT INTO review_ai_analysis_heads (organization_id, property_id, source_epoch, head_sequence)
       VALUES ($1, $2, 0, 0)`,
      [organizationId, propertyId],
    )
    await query(
      `INSERT INTO ai_property_processing_profiles
         (property_id, organization_id, country_code, timezone, processing_region,
          routing_policy_version, provider_deployment_profile_version, source_epoch,
          profile_version, lifecycle_state, updated_at)
       VALUES ($1::uuid, $2, 'US', 'UTC', 'global', 1, 'private-beta-global-v2', 0, 1,
               'active', $3)`,
      [propertyId, organizationId, RIGHTS_FIXTURE_AT],
    )
    await query(
      `SELECT (
         apply_merchant_ai_transition_v1(
           $1::uuid, 0, 1, $2, $3::uuid, 'enable', 'enabled',
           ARRAY['review_analysis']::text[],
           '{"review_analysis":"review-analysis-runtime-v1"}'::jsonb,
           $4, $4, $4, 0, 0, $5, $6, 'google-business-profile-source-policy-v1', 1,
           'global', 'private-beta-global-v2', 'gbp-review-global-v1', $7,
           'merchant_enabled', $8, $9, now()
         )
       ).*`,
      [
        lineageId,
        organizationId,
        propertyId,
        1,
        MERCHANT_AI_NOTICE_VERSION,
        MERCHANT_AI_NOTICE_DIGEST,
        userId,
        `ai-export-enable-${propertyId}`,
        hex64(),
      ],
    )
    return lineageId
  }

  /** One Review with a mention, its sentence numbers and a manager correction. */
  async function seedReview(
    organizationId: string,
    propertyId: string,
    lineageId: string,
    sequence: number,
    kind: Kind,
    label: string,
    control: Awaited<ReturnType<typeof heads>>,
  ) {
    const reviewId = randomUUID()
    const operationId = randomUUID()
    const key = [organizationId, propertyId, reviewId, sequence]
    const [globalControl, globalGeneration] = control('global')
    const [providerControl, providerGeneration] = control(
      'provider:private-beta-global-v2',
    )
    const [capabilityControl, capabilityGeneration] = control(
      'capability:review_analysis',
    )
    await query(
      `INSERT INTO reviews (id, organization_id, property_id, platform, first_fetched_at,
         source_epoch, source_revision, analysis_sequence)
       VALUES ($1, $2, $3, 'google', $4, 0, 1, $5)`,
      [reviewId, organizationId, propertyId, RIGHTS_FIXTURE_AT, sequence],
    )
    await query(
      `INSERT INTO review_source_contents (
         review_id, organization_id, property_id, platform, external_id,
         external_location_id, reviewer_name, rating, text, language_code,
         reviewed_at, last_fetched_at, content_expires_at, source_epoch,
         source_revision, ai_source_byte_length, ai_source_digest
       ) VALUES ($1, $2, $3, 'google', $4, 'locations/ai-export', 'NEVER_EXPORT_NAME', 5,
                 'NEVER_EXPORT_REVIEW_TEXT', 'en', $5, $5, $6, 0, 1, 20, $7)`,
      [
        reviewId,
        organizationId,
        propertyId,
        `ai-export-${reviewId}`,
        RIGHTS_FIXTURE_AT,
        FUTURE,
        'a'.repeat(64),
      ],
    )
    await query(
      `INSERT INTO material_review_revisions (
         review_id, revision, organization_id, property_id, source_epoch,
         normalization_version, source_digest, normalized_digest, rating,
         normalized_text, content_state
       ) VALUES ($1, 1, $2, $3, 0, 'legacy-unverified-v0', NULL, NULL, 5, 'Text', 'active')`,
      [reviewId, organizationId, propertyId],
    )
    await query(
      `INSERT INTO ai_operations (
         id, idempotency_scope, idempotency_key, request_fingerprint,
         source_digest, source_byte_count, command, capability, organization_id,
         property_id, system_principal, review_id, origin_event_id, subject_hmac,
         subject_hmac_key_version, source_epoch, source_revision,
         reviewed_at_epoch_millis, analysis_sequence, authorization_lineage_id,
         routing_policy_version, provider_deployment_profile_version,
         operation_profile_version, capability_runtime_profile_version, global_control_id,
         global_control_generation, provider_control_id,
         provider_control_generation, capability_control_id,
         capability_control_generation, capability_fences, state,
         execution_attempt, created_at, updated_at, expires_at
       ) VALUES (
         $1, 'ai-export-test', $2, $3, $4, 20, 'analysis', 'review_analysis',
         $5, $6, 'review_event_consumer', $7, $8, $9, 'test-v1', 0, 1, $10, $11,
         $12, 1, 'private-beta-global-v2', 'review-analysis-v1',
         'review-analysis-runtime-v1', $13, $14, $15, $16, $17, $18,
         '{"capability":"review_analysis","reviewAnalysisEpoch":"1"}'::jsonb,
         'succeeded', 1, $19, $19, $20
       )`,
      [
        operationId,
        operationId,
        hex64(),
        hex64(),
        organizationId,
        propertyId,
        reviewId,
        randomUUID(),
        hex64(),
        RIGHTS_FIXTURE_AT.getTime(),
        sequence,
        lineageId,
        globalControl,
        globalGeneration,
        providerControl,
        providerGeneration,
        capabilityControl,
        capabilityGeneration,
        RIGHTS_FIXTURE_AT,
        FUTURE,
      ],
    )
    await query(
      `INSERT INTO ai_review_analyses (
         organization_id, property_id, review_id, source_epoch, source_revision,
         analysis_sequence, operation_id, authorization_lineage_id,
         review_analysis_epoch, property_profile_version, analysis_profile_version,
         status, sentiment, primary_category, attention, generated_at, expires_at
       ) VALUES ($1, $2, $3, 0, 1, $4, $5, $6, 1, 1, 'review-analysis-v1', 'ready',
                 'positive', 'service', 'low', $7, $8)`,
      [
        ...key,
        operationId,
        kind === 'retired' ? randomUUID() : lineageId,
        RIGHTS_FIXTURE_AT,
        kind === 'expired' ? PAST : FUTURE,
      ],
    )
    await query(
      `INSERT INTO ai_review_analysis_mentions (
         organization_id, property_id, review_id, source_epoch, source_revision,
         analysis_sequence, mention_ordinal, topic, polarity, strength, thing, issue
       ) VALUES ($1, $2, $3, 0, 1, $4, 0, 'staff_service', 'positive', 'clear', $5, $5)`,
      [...key, label],
    )
    for (const sentenceNumber of [3, 1]) {
      await query(
        `INSERT INTO ai_review_analysis_mention_sentences (
           organization_id, property_id, review_id, source_epoch, source_revision,
           analysis_sequence, mention_ordinal, sentence_number
         ) VALUES ($1, $2, $3, 0, 1, $4, 0, $5)`,
        [...key, sentenceNumber],
      )
    }
    await query(
      `INSERT INTO ai_review_analysis_mention_corrections (
         organization_id, property_id, review_id, source_epoch, source_revision,
         analysis_sequence, mention_ordinal, topic, kind, corrected_by,
         created_at, updated_at
       ) VALUES ($1, $2, $3, 0, 1, $4, 0, 'staff_service', 'remove_topic', $5, $6, $6)`,
      [...key, `manager-${label}`, RIGHTS_FIXTURE_AT],
    )
  }

  async function seedOrganization(tag: string) {
    const control = await heads()
    const seeded = await seedRightsOrganization(query, 1, async () => {})
    organizations.push(seeded.organizationId)
    const propertyId = seeded.propertyIds[0]!
    const lineageId = await seedProperty(seeded.organizationId, propertyId)
    let sequence = 1
    for (const kind of ['served', 'retired', 'expired'] as const) {
      await seedReview(
        seeded.organizationId,
        propertyId,
        lineageId,
        sequence,
        kind,
        `${tag}-${kind}`,
        control,
      )
      sequence += 1
    }
    return seeded.organizationId
  }

  async function exportOf(organizationId: string) {
    const written = new Map<string, Uint8Array>()
    const out: string[] = []
    const code = await runRightsExecutors({
      plan: {
        ...rightsPlan('organization', organizationId, { mode: 'report' }),
        exportDir: '/export',
      },
      executors: [createAiRightsExecutor(db, () => NOW)],
      journal: createRightsJournal(recordingJournalStore().store),
      io: { out: (line) => out.push(line), err: () => {} },
      writeExportFile: async (path, bytes) => {
        written.set(path, bytes)
      },
    })
    const parse = (path: string) =>
      JSON.parse(new TextDecoder().decode(written.get(path))) as {
        columns: string[]
        records: Record<string, unknown>[]
      }
    return { code, paths: [...written.keys()].sort(), parse, written }
  }

  it('writes the served analysis and corrections of one Organization only', async () => {
    const first = await seedOrganization('first')
    await seedOrganization('second')

    const result = await exportOf(first)

    expect(result.code).toBe(0)
    expect(result.paths).toEqual([
      '/export/ai/review-analysis-mention-corrections.json',
      '/export/ai/review-analysis-mentions.json',
    ])
    const mentions = result.parse('/export/ai/review-analysis-mentions.json')
    expect(mentions.records).toHaveLength(1)
    expect(mentions.records[0]).toMatchObject({
      topic: 'staff_service',
      polarity: 'positive',
      strength: 'clear',
      thing: 'first-served',
      issue: 'first-served',
      sentence_numbers: [1, 3],
    })
    expect(Object.keys(mentions.records[0]!).sort()).toEqual([...mentions.columns].sort())
    const corrections = result.parse(
      '/export/ai/review-analysis-mention-corrections.json',
    )
    expect(corrections.records).toHaveLength(1)
    expect(corrections.records[0]).toMatchObject({
      kind: 'remove_topic',
      corrected_by: 'manager-first-served',
    })
    expect(Object.keys(corrections.records[0]!).sort()).toEqual(
      [...corrections.columns].sort(),
    )
  })

  it('leaves out review text, other Organizations and retired or expired analyses', async () => {
    const first = await seedOrganization('first')
    await seedOrganization('second')

    const result = await exportOf(first)
    const text = [...result.written.values()]
      .map((bytes) => new TextDecoder().decode(bytes))
      .join('\n')

    expect(text).not.toContain('NEVER_EXPORT')
    expect(text).not.toContain('second-')
    expect(text).not.toContain('first-retired')
    expect(text).not.toContain('first-expired')
    expect(text).not.toContain(first)
  })

  it('writes empty files for an Organization with no served analysis', async () => {
    const empty = await seedRightsOrganization(query, 0, async () => {})
    organizations.push(empty.organizationId)

    const result = await exportOf(empty.organizationId)

    expect(result.parse('/export/ai/review-analysis-mentions.json').records).toEqual([])
    expect(
      result.parse('/export/ai/review-analysis-mention-corrections.json').records,
    ).toEqual([])
  })
})
