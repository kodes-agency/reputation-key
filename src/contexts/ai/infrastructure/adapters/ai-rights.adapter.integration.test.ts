// AI's rights executor against real PostgreSQL: Property A and B of one
// Organization beside a second Organization. A second suite seeds every table
// the report counts and checks each count against the rows the erasure removes.

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import {
  holdRightsOrganization,
  recordingJournalStore,
  RIGHTS_FIXTURE_AT,
  rightsPlan,
  runRightsExecutor,
  seedRightsOrganization,
  type RightsQuery,
} from '#/shared/db/testing/rights-isolation-fixture'
import { describeRightsIsolation } from '#/shared/db/testing/rights-isolation-suite'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createAiErasureReplayers, createAiRightsExecutor } from './ai-rights.adapter'

describeRightsIsolation({
  environment: { acquireTestLease, deleteTestOrganizations },
  name: 'ai',
  context: 'ai',
  tables: [
    { table: 'ai_property_review_population_daily', hasProperty: true },
    { table: 'ai_property_issue_groups', hasProperty: true },
    { table: 'ai_property_processing_profiles', hasProperty: true },
    { table: 'ai_organization_cost_windows', hasProperty: false },
  ],
  executor: (db) => createAiRightsExecutor(db, () => RIGHTS_FIXTURE_AT),
  replayers: createAiErasureReplayers(() => RIGHTS_FIXTURE_AT),
  async seedProperty(query, organizationId, propertyId) {
    await query(
      `INSERT INTO ai_property_review_population_daily
         (organization_id, property_id, local_date, source_epoch, property_profile_version,
          calendar_profile_version, review_count, text_review_count, rating_1_count,
          rating_2_count, rating_3_count, rating_4_count, rating_5_count,
          population_revision, updated_at)
       VALUES ($1, $2::uuid, '2026-07-31', 0, 1, 'v1', 1, 0, 0, 0, 0, 0, 1, 1, $3)`,
      [organizationId, propertyId, RIGHTS_FIXTURE_AT],
    )
    await query(
      `INSERT INTO ai_property_issue_groups
         (organization_id, property_id, topic, canonical_key, created_at, updated_at,
          last_seen_at, expires_at, normalization_version)
       VALUES ($1, $2::uuid, 'cleanliness', '__topic__', $3, $3, $3, $4, 'v1')`,
      [organizationId, propertyId, RIGHTS_FIXTURE_AT, new Date('2027-08-01T00:00:00Z')],
    )
    await query(
      `INSERT INTO ai_property_processing_profiles
         (property_id, organization_id, country_code, timezone, processing_region,
          routing_policy_version, provider_deployment_profile_version, source_epoch,
          profile_version, lifecycle_state, updated_at)
       VALUES ($2::uuid, $1, 'US', 'UTC', 'global', 1, 'v1', 0, 1, 'active', $3)`,
      [organizationId, propertyId, RIGHTS_FIXTURE_AT],
    )
  },
  async seedOrganization(query, organizationId) {
    await query(
      `INSERT INTO ai_organization_cost_windows (organization_id, window_start)
       VALUES ($1, date_trunc('month', now()))`,
      [organizationId],
    )
  },
})

const REPORTED_BY_PROPERTY = [
  'ai_draft_measurements',
  'ai_review_analysis_backlog',
  'ai_review_analysis_enrollments',
  'ai_property_trend_outcomes',
  'ai_property_trend_schedules',
  'ai_property_aggregate_contributions',
  'ai_property_issue_members',
  'ai_property_issue_groups',
  'ai_property_aggregate_settlements',
  'ai_property_daily_aggregates',
  'ai_property_review_population_daily',
  'ai_property_aggregate_heads',
  'ai_review_analyses',
  'ai_operations',
  'ai_property_processing_profiles',
  'ai_draft_measurement_links',
  'ai_review_analysis_aspects',
  'ai_review_analysis_mentions',
  'ai_review_analysis_mention_sentences',
  'ai_review_analysis_mention_corrections',
  'ai_property_aggregate_contribution_aspects',
  'ai_property_aggregate_contribution_mentions',
  'ai_property_daily_aspect_aggregates',
] as const
const REPORTED_BY_ORGANIZATION = [
  ...REPORTED_BY_PROPERTY,
  'ai_organization_cost_windows',
] as const

const EMPTY_REVISION_SET_DIGEST =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const hex64 = () => randomUUID().replaceAll('-', '').repeat(2)

describe.sequential('ai rights report counts', () => {
  let lease: TestLease
  let db: Database
  let query: RightsQuery
  let userId: string
  const organizations: string[] = []

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 3)
    db = drizzle(lease.pool) as Database
    query = (text, params) => lease.pool.query(text, params)
    userId = `ai-rights-user-${randomUUID()}`
    await query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, 'Rights Manager', $2, true, $3, $3)`,
      [userId, `${userId}@example.test`, RIGHTS_FIXTURE_AT],
    )
  })

  afterEach(async () => {
    for (const organizationId of organizations) {
      await query('DELETE FROM replies WHERE organization_id = $1', [organizationId])
      await query('DELETE FROM properties WHERE organization_id = $1', [organizationId])
      await query('DELETE FROM outbox_events WHERE organization_id = $1', [
        organizationId,
      ])
      await query('DELETE FROM ai_organization_cost_windows WHERE organization_id = $1', [
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

  async function controlHeads() {
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

  /** One Review with an analysis, its derivatives, a contribution and a draft measurement. */
  async function seedReview(
    organizationId: string,
    propertyId: string,
    index: number,
    heads: Awaited<ReturnType<typeof controlHeads>>,
  ): Promise<void> {
    const reviewId = randomUUID()
    const operationId = randomUUID()
    const lineageId = randomUUID()
    const sequence = index + 1
    const key = [organizationId, propertyId, reviewId]
    const at = RIGHTS_FIXTURE_AT
    const [globalControl, globalGeneration] = heads('global')
    const [providerControl, providerGeneration] = heads('provider:private-beta-global-v2')
    const [capabilityControl, capabilityGeneration] = heads('capability:review_analysis')
    await query(
      `INSERT INTO reviews (
         id, organization_id, property_id, platform, external_id, reviewer_name,
         rating, text, language_code, reviewed_at, content_expires_at,
         source_epoch, source_revision, analysis_sequence, ai_source_byte_length,
         ai_source_digest
       ) VALUES ($1, $2, $3, 'google', $4, 'Reviewer', 5, 'Text', 'en', $5, $6, 0, 1, $7, 20, $8)`,
      [
        reviewId,
        organizationId,
        propertyId,
        `ai-rights-${reviewId}`,
        at,
        new Date('2027-08-01T00:00:00.000Z'),
        sequence,
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
         $1, 'ai-rights-test', $2, $3, $4, 20, 'analysis', 'review_analysis',
         $5, $6, 'review_event_consumer', $7, $8, $9, 'test-v1', 0, 1, $10, $11,
         $12, 1, 'private-beta-global-v2', 'review-analysis-v1',
         'review-analysis-runtime-v1', $13, $14, $15, $16, $17, $18,
         '{"capability":"review_analysis","reviewAnalysisEpoch":"1"}'::jsonb,
         'succeeded', 1, $19, $19, $20
       )`,
      [
        operationId,
        operationId,
        hex64().slice(0, 64),
        hex64().slice(0, 64),
        organizationId,
        propertyId,
        reviewId,
        randomUUID(),
        hex64().slice(0, 64),
        at.getTime(),
        sequence,
        lineageId,
        globalControl,
        globalGeneration,
        providerControl,
        providerGeneration,
        capabilityControl,
        capabilityGeneration,
        at,
        new Date('2027-08-01T00:00:00.000Z'),
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
        sequence,
        operationId,
        lineageId,
        at,
        new Date('2027-08-01T00:00:00.000Z'),
      ],
    )
    const analysisKey = [...key, sequence]
    await query(
      `INSERT INTO ai_review_analysis_aspects (
         organization_id, property_id, review_id, source_epoch, source_revision,
         analysis_sequence, aspect, polarity, intensity
       ) VALUES ($1, $2, $3, 0, 1, $4, 'service', 'positive', 50)`,
      analysisKey,
    )
    await query(
      `INSERT INTO ai_review_analysis_mentions (
         organization_id, property_id, review_id, source_epoch, source_revision,
         analysis_sequence, mention_ordinal, topic, polarity, strength
       ) VALUES ($1, $2, $3, 0, 1, $4, 0, 'staff_service', 'positive', 'clear')`,
      analysisKey,
    )
    await query(
      `INSERT INTO ai_review_analysis_mention_sentences (
         organization_id, property_id, review_id, source_epoch, source_revision,
         analysis_sequence, mention_ordinal, sentence_number
       ) VALUES ($1, $2, $3, 0, 1, $4, 0, 1)`,
      analysisKey,
    )
    await query(
      `INSERT INTO ai_review_analysis_mention_corrections (
         organization_id, property_id, review_id, source_epoch, source_revision,
         analysis_sequence, mention_ordinal, topic, kind, corrected_by,
         created_at, updated_at
       ) VALUES ($1, $2, $3, 0, 1, $4, 0, 'staff_service', 'remove_topic', 'manager', $5, $5)`,
      [...analysisKey, at],
    )
    await query(
      `INSERT INTO ai_property_aggregate_contributions (
         organization_id, property_id, review_id, source_epoch, source_revision,
         analysis_sequence, review_analysis_epoch, property_profile_version,
         calendar_profile_version, local_date, status, rating, sentiment,
         primary_category, attention, applied_aggregate_revision, applied_at
       ) VALUES ($1, $2, $3, 0, 1, $4, 1, 1, 'property-calendar-v1', '2026-08-27',
                 'ready', 5, 'positive', 'service', 'low', 1, $5)`,
      [...analysisKey, at],
    )
    await query(
      `INSERT INTO ai_property_aggregate_contribution_aspects (
         organization_id, property_id, review_id, source_epoch, source_revision,
         analysis_sequence, aspect, polarity, intensity
       ) VALUES ($1, $2, $3, 0, 1, $4, 'service', 'positive', 50)`,
      analysisKey,
    )
    await query(
      `INSERT INTO ai_property_aggregate_contribution_mentions (
         organization_id, property_id, review_id, source_epoch, source_revision,
         analysis_sequence, mention_ordinal, topic, polarity, strength
       ) VALUES ($1, $2, $3, 0, 1, $4, 0, 'staff_service', 'positive', 'clear')`,
      analysisKey,
    )
    await query(
      `INSERT INTO ai_property_aggregate_settlements (
         organization_id, property_id, review_id, source_epoch,
         review_analysis_epoch, analysis_sequence, settled_at
       ) VALUES ($1, $2, $3, 0, 1, $4, $5)`,
      [...analysisKey, at],
    )
    await query(
      `INSERT INTO ai_review_analysis_backlog (
         event_envelope_id, organization_id, property_id, review_id, source_epoch,
         source_revision, analysis_sequence, origin, next_attempt_at
       ) VALUES ($1, $2, $3, $4, 0, 1, $5, 'backfill', $6)`,
      [randomUUID(), ...key, sequence, at],
    )
    const measurementId = randomUUID()
    await query(
      `INSERT INTO ai_draft_measurements (
         id, operation_id, organization_id, property_id, review_id, actor_user_id,
         request_key, contract, intent, trigger, tone, language, rating_band,
         provider_attempts, outcome, latency_ms, base_reply_revision, created_at
       ) VALUES ($1, $2, $3, $4, $5, 'manager', $6, 'v1', 'explicit', 'draft',
                 'professional', 'en-Latn-US', 'high', 1, 'ready', 100, 0, $7)`,
      [
        measurementId,
        operationId,
        organizationId,
        propertyId,
        reviewId,
        randomUUID(),
        at,
      ],
    )
    const replyId = randomUUID()
    await query(
      `INSERT INTO replies (
         id, review_id, organization_id, text, status, source, created_by, submitted_by,
         approved_by, authorship, publication_state, publication_cycle, created_at, updated_at
       ) VALUES ($1, $2, $3, 'Reply', 'published', 'internal', $4, $4, $4, 'human',
                 'published', 1, $5, $5)`,
      [replyId, reviewId, organizationId, userId, at],
    )
    await query(
      `INSERT INTO ai_draft_measurement_links (generation_id, reply_id, reply_revision)
       VALUES ($1, $2, 1)`,
      [measurementId, replyId],
    )
  }

  /** The merchant consent the enrollment points at, revoked so an erasure is allowed. */
  async function seedConsent(
    organizationId: string,
    propertyId: string,
    lineageId: string,
  ): Promise<void> {
    const transition = (
      args: readonly [number, number, string, string, string, string, string],
      scopes: string,
      versions: string,
    ) =>
      query(
        `SELECT (
           apply_merchant_ai_transition_v1(
             $1::uuid, $2, $3, $4, $5::uuid, $6, $7, ${scopes}, ${versions},
             $3, $3, $3, 0, 0, $8, $9, 'google-business-profile-source-policy-v1', 1,
             'global', 'private-beta-global-v2', 'gbp-review-global-v1', $10,
             $11, $12, $13, now()
           )
         ).*`,
        [
          lineageId,
          args[0],
          args[1],
          organizationId,
          propertyId,
          args[2],
          args[3],
          MERCHANT_AI_NOTICE_VERSION,
          MERCHANT_AI_NOTICE_DIGEST,
          userId,
          args[4],
          args[5],
          args[6],
        ],
      )
    await transition(
      [
        0,
        1,
        'enable',
        'enabled',
        'merchant_enabled',
        `ai-rights-enable-${propertyId}`,
        hex64().slice(0, 64),
      ],
      `ARRAY['review_analysis', 'property_trends']::text[]`,
      `'{"review_analysis":"review-analysis-runtime-v1","property_trends":"property-trends-runtime-v1"}'::jsonb`,
    )
    await transition(
      [
        1,
        2,
        'revoke',
        'revoked',
        'organization_closing',
        `ai-rights-revoke-${propertyId}`,
        hex64().slice(0, 64),
      ],
      `ARRAY[]::text[]`,
      `'{}'::jsonb`,
    )
  }

  /** A merchant authorization needs an active Property bound to a Google connection. */
  async function activateProperty(
    organizationId: string,
    propertyId: string,
  ): Promise<void> {
    const connectionId = randomUUID()
    await query(
      `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
       VALUES ($1, $2, $3, 'owner', now())
       ON CONFLICT DO NOTHING`,
      [`ai-rights-member-${organizationId}`, userId, organizationId],
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
         gbp_account_id = 'account-ai-rights', gbp_location_id = 'location-' || $2::text,
         google_binding_state = 'active', profile_source = 'legacy', source_epoch = 0
       WHERE organization_id = $1 AND id = $2::uuid`,
      [organizationId, propertyId, connectionId],
    )
    await query(
      `INSERT INTO review_ai_analysis_heads (organization_id, property_id, source_epoch, head_sequence)
       VALUES ($1, $2, 0, 0)`,
      [organizationId, propertyId],
    )
  }

  /** Everything one Property holds outside its Reviews; `reviews` scales the counts. */
  async function seedProperty(
    organizationId: string,
    propertyId: string,
    reviews: number,
  ): Promise<void> {
    const heads = await controlHeads()
    const at = RIGHTS_FIXTURE_AT
    await activateProperty(organizationId, propertyId)
    const lineageId = randomUUID()
    const issueGroupId = randomUUID()
    const scheduleId = randomUUID()
    await query(
      `INSERT INTO ai_property_processing_profiles
         (property_id, organization_id, country_code, timezone, processing_region,
          routing_policy_version, provider_deployment_profile_version, source_epoch,
          profile_version, lifecycle_state, updated_at)
       VALUES ($1::uuid, $2, 'US', 'UTC', 'global', 1, 'private-beta-global-v2', 0, 1, 'active', $3)`,
      [propertyId, organizationId, at],
    )
    await seedConsent(organizationId, propertyId, lineageId)
    await query(
      `INSERT INTO ai_review_analysis_enrollments (
         id, organization_id, property_id, authorization_lineage_id,
         authorization_state_version, source_epoch, review_analysis_epoch,
         analysis_start_sequence, provider_deployment_profile_version,
         trigger_event_envelope_id, state, snapshot_revision_count,
         snapshot_revision_set_digest, snapshot_captured_at, created_at, updated_at,
         terminal_reason, terminal_at
       ) VALUES ($1, $2, $3, $4, 1, 0, 1, 0, 'private-beta-global-v2', $5,
                 'superseded', 0, $6, $7, $7, $7, 'superseded_by_test', $7)`,
      [
        randomUUID(),
        organizationId,
        propertyId,
        lineageId,
        randomUUID(),
        EMPTY_REVISION_SET_DIGEST,
        at,
      ],
    )
    await query(
      `INSERT INTO ai_property_issue_groups (
         id, organization_id, property_id, topic, canonical_thing, canonical_key,
         created_at, updated_at, last_seen_at, expires_at, normalization_version
       ) VALUES ($1, $2, $3, 'facilities_equipment', 'air conditioning',
                 'air conditioning', $4, $4, $4, $5, 'property-issue-normalization-v1')`,
      [
        issueGroupId,
        organizationId,
        propertyId,
        at,
        new Date('2027-08-01T00:00:00.000Z'),
      ],
    )
    await query(
      `INSERT INTO ai_property_issue_members (
         issue_group_id, organization_id, property_id, topic, member_key,
         member_thing, source, created_at, last_seen_at
       ) VALUES ($1, $2, $3, 'facilities_equipment', 'air conditioning',
                 'air conditioning', 'deterministic', $4, $4)`,
      [issueGroupId, organizationId, propertyId, at],
    )
    await query(
      `INSERT INTO ai_property_trend_schedules (
         id, outbox_event_id, organization_id, property_id, due_local_date,
         source_epoch, review_analysis_epoch, property_trends_epoch,
         property_profile_version, terminal_analysis_sequence, aggregate_revision,
         timezone, calendar_profile_version, report_profile_version,
         scheduler_generation, scheduled_at
       ) VALUES ($1, $2, $3, $4, '2026-08-27', 0, 1, 1, 1, 1, 1, 'UTC',
                 'property-calendar-v1', 'property-trend-v1', 1, $5)`,
      [scheduleId, randomUUID(), organizationId, propertyId, at],
    )
    await query(
      `INSERT INTO ai_property_trend_outcomes (
         schedule_id, organization_id, property_id, disposition,
         selected_signal_ids, signal_key, direction, confidence_basis_points,
         supporting_review_count, headline, sentences, summary,
         render_profile_version, render_profile_digest, recorded_at, expires_at
       ) VALUES ($1, $2, $3, 'ready', '["category.service"]'::jsonb,
                 'category.service', 'improving', 1500, 1,
                 'Review signals improved', '["Service improved."]'::jsonb, 'Summary',
                 'trend-render-v1', $4, $5, $6)`,
      [
        scheduleId,
        organizationId,
        propertyId,
        '4'.repeat(64),
        at,
        new Date('2027-08-01T00:00:00.000Z'),
      ],
    )
    await query(
      `INSERT INTO ai_property_aggregate_heads (
         organization_id, property_id, source_epoch, review_analysis_epoch,
         property_profile_version, aggregate_revision, terminal_analysis_sequence, updated_at
       ) VALUES ($1, $2, 0, 1, 1, 1, 1, $3)`,
      [organizationId, propertyId, at],
    )
    for (let index = 0; index < reviews; index += 1) {
      const localDate = `2026-08-${String(10 + index).padStart(2, '0')}`
      await query(
        `INSERT INTO ai_property_daily_aggregates (
           organization_id, property_id, local_date, source_epoch,
           review_analysis_epoch, property_profile_version, calendar_profile_version,
           aggregate_revision, terminal_analysis_sequence, review_count, rating_sum,
           positive_count, neutral_count, negative_count, mixed_count, urgent_count,
           high_count, medium_count, low_count, updated_at
         ) VALUES ($1, $2, $3, 0, 1, 1, 'property-calendar-v1', 1, 1, 1, 5, 1, 0, 0,
                   0, 0, 0, 0, 1, $4)`,
        [organizationId, propertyId, localDate, at],
      )
      await query(
        `INSERT INTO ai_property_daily_aspect_aggregates (
           organization_id, property_id, local_date, source_epoch,
           review_analysis_epoch, property_profile_version, aspect, polarity, mention_count
         ) VALUES ($1, $2, $3, 0, 1, 1, 'service', 'positive', 1)`,
        [organizationId, propertyId, localDate],
      )
      await query(
        `INSERT INTO ai_property_review_population_daily (
           organization_id, property_id, local_date, source_epoch, property_profile_version,
           calendar_profile_version, review_count, text_review_count, rating_1_count,
           rating_2_count, rating_3_count, rating_4_count, rating_5_count,
           population_revision, updated_at
         ) VALUES ($1, $2, $3, 0, 1, 'property-calendar-v1', 1, 1, 0, 0, 0, 0, 1, 1, $4)`,
        [organizationId, propertyId, localDate, at],
      )
      await seedReview(organizationId, propertyId, index, heads)
    }
  }

  /** Property A holds one of each row, B two, the other Organization's Property three. */
  async function seedAll() {
    const first = await seedRightsOrganization(query, 2, async () => {})
    const other = await seedRightsOrganization(query, 1, async () => {})
    organizations.push(first.organizationId, other.organizationId)
    const [a, b] = first.propertyIds as [string, string]
    const c = other.propertyIds[0]!
    await seedProperty(first.organizationId, a, 1)
    await seedProperty(first.organizationId, b, 2)
    await seedProperty(other.organizationId, c, 3)
    for (const organizationId of [first.organizationId, other.organizationId]) {
      await query(
        `INSERT INTO ai_organization_cost_windows (organization_id, window_start)
         VALUES ($1, date_trunc('month', now()))`,
        [organizationId],
      )
    }
    return { first, other, a, b, c }
  }

  /** Rows a table holds for the Organizations, counted without the report's code. */
  async function owned(
    table: string,
    organizationIds: readonly string[],
    propertyId?: string,
  ): Promise<number> {
    const inProperty = (column: string) =>
      `AND ($2::uuid IS NULL OR ${column} = $2::uuid)`
    const result = await query(
      table === 'ai_draft_measurement_links'
        ? `SELECT count(*)::int AS n FROM ai_draft_measurement_links l
           JOIN ai_draft_measurements m ON m.id = l.generation_id
           WHERE m.organization_id = ANY($1::text[]) ${inProperty('m.property_id')}`
        : `SELECT count(*)::int AS n FROM ${table} t
           WHERE t.organization_id = ANY($1::text[])
           ${table === 'ai_organization_cost_windows' ? 'AND $2::uuid IS NULL' : inProperty('t.property_id')}`,
      [organizationIds, propertyId ?? null],
    )
    return Number(result.rows[0]!.n)
  }

  async function reportOf(
    plan: ReturnType<typeof rightsPlan>,
  ): Promise<ReadonlyMap<string, number>> {
    const lines = await createAiRightsExecutor(db, () => RIGHTS_FIXTURE_AT).report(plan)
    return new Map(
      lines.map((line) => {
        const [table, value] = line.split(' ')
        return [table!, Number(value)] as const
      }),
    )
  }

  it('reports a Property erasure as exactly the rows it removes', async () => {
    const { first, other, a, b } = await seedAll()
    const everyone = [first.organizationId, other.organizationId]
    const plan = rightsPlan('property', first.organizationId, { propertyId: a })
    const report = await reportOf(plan)
    const beforeAll = new Map<string, number>()
    const beforeB = new Map<string, number>()
    const beforeOther = new Map<string, number>()
    for (const table of REPORTED_BY_PROPERTY) {
      beforeAll.set(table, await owned(table, everyone))
      beforeB.set(table, await owned(table, [first.organizationId], b))
      beforeOther.set(table, await owned(table, [other.organizationId]))
      expect(await owned(table, [first.organizationId], a), table).toBeGreaterThan(0)
    }

    const result = await runRightsExecutor(
      createAiRightsExecutor(db, () => RIGHTS_FIXTURE_AT),
      plan,
      recordingJournalStore().store,
    )

    expect(result.err).toEqual([])
    expect([...report.keys()].sort()).toEqual([...REPORTED_BY_PROPERTY].sort())
    for (const table of REPORTED_BY_PROPERTY) {
      expect(report.get(table), table).toBe(
        beforeAll.get(table)! - (await owned(table, everyone)),
      )
      expect(await owned(table, [first.organizationId], a), table).toBe(0)
      expect(await owned(table, [first.organizationId], b), table).toBe(
        beforeB.get(table),
      )
      expect(await owned(table, [other.organizationId]), table).toBe(
        beforeOther.get(table),
      )
    }
  })

  it('reports an Organization erasure as exactly the rows it removes', async () => {
    const { first, other } = await seedAll()
    holdRightsOrganization(first.organizationId)
    const everyone = [first.organizationId, other.organizationId]
    const plan = rightsPlan('organization', first.organizationId)
    const report = await reportOf(plan)
    const beforeAll = new Map<string, number>()
    const beforeOther = new Map<string, number>()
    for (const table of REPORTED_BY_ORGANIZATION) {
      beforeAll.set(table, await owned(table, everyone))
      beforeOther.set(table, await owned(table, [other.organizationId]))
      expect(await owned(table, [first.organizationId]), table).toBeGreaterThan(0)
    }

    const result = await runRightsExecutor(
      createAiRightsExecutor(db, () => RIGHTS_FIXTURE_AT),
      plan,
      recordingJournalStore().store,
    )

    expect(result.err).toEqual([])
    expect([...report.keys()].sort()).toEqual([...REPORTED_BY_ORGANIZATION].sort())
    for (const table of REPORTED_BY_ORGANIZATION) {
      expect(report.get(table), table).toBe(
        beforeAll.get(table)! - (await owned(table, everyone)),
      )
      expect(await owned(table, [first.organizationId]), table).toBe(0)
      expect(await owned(table, [other.organizationId]), table).toBe(
        beforeOther.get(table),
      )
    }
  })
})
