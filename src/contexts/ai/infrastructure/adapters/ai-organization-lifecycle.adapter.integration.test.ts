// LIF-01-T12/T13/T14 — AI lifecycle contributor against real PostgreSQL.
//
// The unit test proves the decision logic. Only a real schema can prove:
//   * `prepareClosing` DELETES NOTHING while every AI work authority is retired;
//   * `verifyPurgeReadiness` MUTATES NOTHING and genuinely refuses while the
//     merchant authorization is still enabled;
//   * `purge` erases every retained derivative UNRESURRECTABLY — the real
//     serving/export read path reports `no_data` afterwards — keeps the
//     independently retained consent evidence, and leaves a second tenant
//     byte-identical.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createAiOrganizationExportContributor } from './ai-organization-export.adapter'
import {
  AiPurgeReadinessBlockedError,
  createAiOrganizationLifecycleContributor,
} from './ai-organization-lifecycle.adapter'

/** Every AI-owned, Organization-scoped table this contributor may touch. */
const OWNED_TABLES = [
  'merchant_ai_consent_evidence',
  'merchant_ai_enablement',
  'ai_property_processing_profiles',
  'ai_review_analyses',
  'ai_property_daily_aggregates',
  'ai_property_trend_schedules',
  'ai_property_trend_outcomes',
  'ai_operations',
  'ai_property_quota_windows',
  'ai_admission_cost_reservations',
  'ai_review_analysis_enrollments',
  'ai_review_analysis_backfill_runs',
  'ai_authorization_lifecycle_records',
] as const

/**
 * Rows purge deliberately keeps. `merchant_ai_consent_evidence` is the
 * append-only consent history the data-fate authority classifies as retained;
 * `merchant_ai_enablement` can only be removed by the schema's own cascade when
 * Property purges its `properties` rows.
 */
const RETAINED_TABLES = [
  'merchant_ai_consent_evidence',
  'merchant_ai_enablement',
] as const

const PURGED_TABLES = OWNED_TABLES.filter(
  (table) => !RETAINED_TABLES.includes(table as (typeof RETAINED_TABLES)[number]),
)

/** Tenant-derived markers that must not survive purge or reach a receipt. */
const MARKERS = Object.freeze({
  reviewText: 'CLOSURE_GUEST_REVIEW_TEXT',
  reviewerName: 'CLOSURE_REVIEWER_NAME',
  // `headline` is pinned to three fixed strings by schema, so the derivative
  // marker rides on the free-text summary instead.
  trendSummary: 'CLOSURE_TREND_SUMMARY',
})

/** SHA-256 of the empty byte string: the only legal empty-population digest. */
const EMPTY_REVISION_SET_DIGEST =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

const CREATED_AT = new Date('2026-08-01T00:00:00.000Z')
const ANALYZED_AT = new Date('2026-08-27T09:30:00.000Z')
const LOCAL_DATE = '2026-08-27'
const RECOVERABLE_UNTIL = new Date('2026-09-28T00:00:00.000Z')
const OCCURRED_AT = new Date('2026-08-28T00:00:00.000Z')
const REQUESTED_AT = new Date(OCCURRED_AT.getTime() - 60_000)

type Fixture = Readonly<{
  organizationId: string
  userId: string
  memberId: string
  propertyId: string
  connectionId: string
  lineageId: string
  reviewId: string
  operationId: string
  permitId: string
  scheduleId: string
  enrollmentId: string
  backfillRunId: string
}>

const fixtures: Fixture[] = []
const bareOrganizations = new Set<string>()
let lease: TestLease
let db: Database

function contributionRequest(
  organizationId: string,
  closureLineageId: string,
  lifecycleRevision: number,
) {
  return {
    organizationId,
    closureLineageId,
    lifecycleRevision,
    recoverableUntil: RECOVERABLE_UNTIL,
    occurredAt: OCCURRED_AT,
  } as const
}

async function controlHeads(): Promise<
  Readonly<Record<string, { controlId: string; generation: number }>>
> {
  const result = await lease.pool.query<{
    scope_key: string
    control_id: string
    generation: string
  }>(
    `SELECT scope_key, control_id, generation
     FROM ai_execution_control_heads
     WHERE scope_key IN ('global', 'provider:private-beta-global-v1',
                         'capability:review_analysis')`,
  )
  return Object.fromEntries(
    result.rows.map((row) => [
      row.scope_key,
      { controlId: row.control_id, generation: Number(row.generation) },
    ]),
  )
}

async function seedBareOrganization(): Promise<string> {
  const organizationId = `ai-lifecycle-bare-${randomUUID()}`
  bareOrganizations.add(organizationId)
  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'AI lifecycle bare fixture', $1, $2)`,
    [organizationId, CREATED_AT],
  )
  return organizationId
}

async function seedFixture(): Promise<Fixture> {
  const suffix = randomUUID()
  const fixture: Fixture = {
    organizationId: `ai-lifecycle-org-${suffix}`,
    userId: `ai-lifecycle-user-${suffix}`,
    memberId: `ai-lifecycle-member-${suffix}`,
    propertyId: randomUUID(),
    connectionId: randomUUID(),
    lineageId: randomUUID(),
    reviewId: randomUUID(),
    operationId: randomUUID(),
    permitId: randomUUID(),
    scheduleId: randomUUID(),
    enrollmentId: randomUUID(),
    backfillRunId: randomUUID(),
  }
  fixtures.push(fixture)

  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'AI lifecycle fixture', $1, $2)`,
    [fixture.organizationId, CREATED_AT],
  )
  await lease.pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Closure Manager', $2, true, now(), now())`,
    [fixture.userId, `${suffix}@example.test`],
  )
  await lease.pool.query(
    `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
     VALUES ($1, $2, $3, 'owner', now())`,
    [fixture.memberId, fixture.userId, fixture.organizationId],
  )
  await lease.pool.query(
    `INSERT INTO google_connections (
       id, organization_id, google_subject, encrypted_access_token,
       encrypted_refresh_token, token_expires_at, scopes, connected_by,
       visibility, status
     ) VALUES ($1, $2, $3, 'encrypted-access', 'encrypted-refresh',
               now() + interval '1 hour',
               ARRAY['https://www.googleapis.com/auth/business.manage'], $4,
               'organization', 'active')`,
    [fixture.connectionId, fixture.organizationId, `subject-${suffix}`, fixture.userId],
  )
  await lease.pool.query(
    `INSERT INTO properties (
       id, organization_id, name, slug, timezone, lifecycle_state,
       google_connection_id, gbp_account_id, gbp_location_id,
       google_binding_state, profile_source, routing_policy_version,
       processing_region, source_epoch
     ) VALUES ($1, $2, 'AI Closure Property', $3, 'UTC', 'active', $4,
               'account-ai-closure', 'location-ai-closure', 'active', 'legacy', 1,
               'global', 0)`,
    [
      fixture.propertyId,
      fixture.organizationId,
      `ai-closure-${suffix}`,
      fixture.connectionId,
    ],
  )
  await lease.pool.query(
    `INSERT INTO review_ai_analysis_heads (
       organization_id, property_id, source_epoch, head_sequence
     ) VALUES ($1, $2, 0, 0)`,
    [fixture.organizationId, fixture.propertyId],
  )
  await lease.pool.query(
    `INSERT INTO ai_property_processing_profiles (
       property_id, organization_id, country_code, timezone, processing_region,
       routing_policy_version, provider_deployment_profile_version, source_epoch,
       profile_version, lifecycle_state, updated_at
     ) VALUES ($1, $2, 'US', 'UTC', 'global', 1, 'private-beta-global-v1', 0, 1,
               'active', now())`,
    [fixture.propertyId, fixture.organizationId],
  )
  await lease.pool.query(
    `SELECT (
       apply_merchant_ai_transition_v1(
         $1::uuid, 0, 1, $2, $3::uuid, 'enable', 'enabled',
         ARRAY['review_analysis', 'property_trends']::text[],
         '{"review_analysis":"review-analysis-runtime-v1","property_trends":"property-trends-runtime-v1"}'::jsonb,
         1, 1, 1, 0, 0, $4, $5, 'google-business-profile-source-policy-v1', 1,
         'global', 'private-beta-global-v1', 'gbp-review-global-v1', $6,
         'merchant_enabled', $7, $8, now()
       )
     ).*`,
    [
      fixture.lineageId,
      fixture.organizationId,
      fixture.propertyId,
      MERCHANT_AI_NOTICE_VERSION,
      MERCHANT_AI_NOTICE_DIGEST,
      fixture.userId,
      `ai-closure-enable-${suffix}`,
      'b'.repeat(64),
    ],
  )

  await lease.pool.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id, reviewer_name,
       rating, text, language_code, reviewed_at, content_expires_at,
       source_epoch, source_revision, analysis_sequence, ai_source_byte_length,
       ai_source_digest
     ) VALUES ($1, $2, $3, 'google', $4, $5, 5, $6, 'en', $7, $8, 0, 1, 1, 20, $9)`,
    [
      fixture.reviewId,
      fixture.organizationId,
      fixture.propertyId,
      `closure-review-${suffix}`,
      MARKERS.reviewerName,
      MARKERS.reviewText,
      new Date('2026-08-20T10:00:00.000Z'),
      new Date('2027-08-20T10:00:00.000Z'),
      'a'.repeat(64),
    ],
  )
  await lease.pool.query(
    `INSERT INTO material_review_revisions (
       review_id, revision, organization_id, property_id, source_epoch,
       normalization_version, source_digest, normalized_digest, rating,
       normalized_text, content_state
     ) VALUES ($1, 1, $2, $3, 0, 'legacy-unverified-v0', NULL, NULL, 5, $4, 'active')`,
    [fixture.reviewId, fixture.organizationId, fixture.propertyId, MARKERS.reviewText],
  )

  const heads = await controlHeads()
  await lease.pool.query(
    `INSERT INTO ai_operations (
       id, idempotency_scope, idempotency_key, request_fingerprint,
       source_digest, source_byte_count, command, capability, organization_id,
       property_id, system_principal, review_id, origin_event_id, subject_hmac,
       subject_hmac_key_version, source_epoch, source_revision,
       reviewed_at_epoch_millis, analysis_sequence, authorization_lineage_id,
       provider_deployment_profile_version, operation_profile_version,
       capability_runtime_profile_version, global_control_id,
       global_control_generation, provider_control_id,
       provider_control_generation, capability_control_id,
       capability_control_generation, capability_fences, state,
       execution_attempt, created_at, updated_at, expires_at
     ) VALUES (
       $1, 'ai-lifecycle-test', $2, $3, $4, 20, 'analysis', 'review_analysis',
       $5, $6, 'review_event_consumer', $7, $8, $9, 'test-v1', 0, 1, $10, 1,
       $11, 'private-beta-global-v1', 'review-analysis-v1',
       'review-analysis-runtime-v1', $12, $13, $14, $15, $16, $17,
       '{"capability":"review_analysis","reviewAnalysisEpoch":"1"}'::jsonb,
       'succeeded', 1, $18, $18, $19
     )`,
    [
      fixture.operationId,
      `closure-${suffix}`,
      '1'.repeat(64),
      '2'.repeat(64),
      fixture.organizationId,
      fixture.propertyId,
      fixture.reviewId,
      randomUUID(),
      '3'.repeat(64),
      ANALYZED_AT.getTime(),
      fixture.lineageId,
      heads.global!.controlId,
      heads.global!.generation,
      heads['provider:private-beta-global-v1']!.controlId,
      heads['provider:private-beta-global-v1']!.generation,
      heads['capability:review_analysis']!.controlId,
      heads['capability:review_analysis']!.generation,
      ANALYZED_AT,
      new Date(ANALYZED_AT.getTime() + 60_000),
    ],
  )
  await lease.pool.query(
    `INSERT INTO ai_review_analyses (
       organization_id, property_id, review_id, source_epoch, source_revision,
       analysis_sequence, operation_id, authorization_lineage_id,
       review_analysis_epoch, property_profile_version, analysis_profile_version,
       status, sentiment, primary_category, attention, generated_at, expires_at
     ) VALUES ($1, $2, $3, 0, 1, 1, $4, $5, 1, 1, 'review-analysis-v1', 'ready',
               'positive', 'service', 'low', $6, $7)`,
    [
      fixture.organizationId,
      fixture.propertyId,
      fixture.reviewId,
      fixture.operationId,
      fixture.lineageId,
      ANALYZED_AT,
      new Date(Date.now() + 86_400_000),
    ],
  )
  await lease.pool.query(
    `INSERT INTO ai_property_daily_aggregates (
       organization_id, property_id, local_date, source_epoch,
       review_analysis_epoch, property_profile_version,
       calendar_profile_version, aggregate_revision, terminal_analysis_sequence,
       review_count, rating_sum, positive_count, neutral_count, negative_count,
       mixed_count, service_count, staff_count, quality_count, value_count,
       cleanliness_count, wait_time_count, atmosphere_count, location_count,
       accessibility_count, other_count, urgent_count, high_count,
       medium_count, low_count, updated_at
     ) VALUES ($1, $2, $3, 0, 1, 1, 'property-calendar-v1', 1, 1, 1, 5, 1, 0, 0,
               0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, $4)`,
    [fixture.organizationId, fixture.propertyId, LOCAL_DATE, ANALYZED_AT],
  )
  await lease.pool.query(
    `INSERT INTO ai_property_trend_schedules (
       id, outbox_event_id, organization_id, property_id, due_local_date,
       source_epoch, review_analysis_epoch, property_trends_epoch,
       property_profile_version, terminal_analysis_sequence,
       aggregate_revision, timezone, calendar_profile_version,
       report_profile_version, scheduler_generation, scheduled_at
     ) VALUES ($1, $2, $3, $4, $5, 0, 1, 1, 1, 1, 1, 'UTC',
               'property-calendar-v1', 'property-trend-v1', 1, $6)`,
    [
      fixture.scheduleId,
      randomUUID(),
      fixture.organizationId,
      fixture.propertyId,
      LOCAL_DATE,
      ANALYZED_AT,
    ],
  )
  await lease.pool.query(
    `INSERT INTO ai_property_trend_outcomes (
       schedule_id, organization_id, property_id, disposition,
       selected_signal_ids, signal_key, direction, confidence_basis_points,
       supporting_review_count, headline, sentences, summary,
       render_profile_version, render_profile_digest, recorded_at, expires_at
     ) VALUES ($1, $2, $3, 'ready', '["category.service"]'::jsonb,
               'category.service', 'improving', 1500, 1,
               'Review signals improved', '["Service improved."]'::jsonb, $4,
               'trend-render-v1', $5, $6, $7)`,
    [
      fixture.scheduleId,
      fixture.organizationId,
      fixture.propertyId,
      MARKERS.trendSummary,
      '4'.repeat(64),
      ANALYZED_AT,
      new Date(Date.now() + 86_400_000),
    ],
  )
  // The permit binds to an exact operation ATTEMPT, so the attempt row has to
  // exist before it.
  await lease.pool.query(
    `INSERT INTO ai_operation_attempts (
       operation_id, attempt, state, started_at, settled_at, model_snapshot,
       input_tokens, output_tokens
     ) VALUES ($1, 1, 'completed', $2, $2, 'closure-model-snapshot', 10, 20)`,
    [fixture.operationId, ANALYZED_AT],
  )
  await lease.pool.query(
    `INSERT INTO ai_execution_permits (
       id, operation_id, execution_attempt, global_control_id,
       global_control_generation, provider_control_id,
       provider_control_generation, admitted_at, expires_at, route, state
     ) VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, 'review-analysis', 'issued')`,
    [
      fixture.permitId,
      fixture.operationId,
      heads.global!.controlId,
      heads.global!.generation,
      heads['provider:private-beta-global-v1']!.controlId,
      heads['provider:private-beta-global-v1']!.generation,
      ANALYZED_AT,
      new Date(ANALYZED_AT.getTime() + 60_000),
    ],
  )
  await lease.pool.query(
    `INSERT INTO ai_property_quota_windows (
       property_id, organization_id, generation, property_profile_version,
       timezone, local_date, starts_at, ends_at, updated_at
     ) VALUES ($1, $2, 1, 1, 'UTC', $3, $4, $5, $4)`,
    [
      fixture.propertyId,
      fixture.organizationId,
      LOCAL_DATE,
      new Date(`${LOCAL_DATE}T00:00:00.000Z`),
      new Date(`${LOCAL_DATE}T23:59:59.000Z`),
    ],
  )
  await lease.pool.query(
    `INSERT INTO ai_admission_cost_reservations (
       permit_id, organization_id, property_id, property_window_generation,
       organization_utc_date, maximum_cost_micros, state, created_at
     ) VALUES ($1, $2, $3, 1, $4, 1000, 'reserved', $5)`,
    [
      fixture.permitId,
      fixture.organizationId,
      fixture.propertyId,
      LOCAL_DATE,
      ANALYZED_AT,
    ],
  )

  // The two work authorities closing must retire.
  await lease.pool.query(
    `INSERT INTO ai_review_analysis_enrollments (
       id, organization_id, property_id, authorization_lineage_id,
       authorization_state_version, source_epoch, review_analysis_epoch,
       analysis_start_sequence, provider_deployment_profile_version,
       trigger_event_envelope_id, state, snapshot_revision_count,
       snapshot_revision_set_digest, snapshot_captured_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 1, 0, 1, 0, 'private-beta-global-v1', $5,
               'queued', 0, $6, $7, $7, $7)`,
    [
      fixture.enrollmentId,
      fixture.organizationId,
      fixture.propertyId,
      fixture.lineageId,
      randomUUID(),
      EMPTY_REVISION_SET_DIGEST,
      ANALYZED_AT,
    ],
  )
  await lease.pool.query(
    `INSERT INTO ai_review_analysis_backfill_runs (
       id, organization_id, property_id, source_epoch, review_analysis_epoch,
       analysis_start_sequence, review_ids, requested_review_count, state,
       reason_code, correlation_id, created_at, updated_at
     ) VALUES ($1, $2, $3, 0, 1, 0, ARRAY[]::uuid[], 1, 'running',
               'operator_backfill', $4, $5, $5)`,
    [
      fixture.backfillRunId,
      fixture.organizationId,
      fixture.propertyId,
      randomUUID(),
      ANALYZED_AT,
    ],
  )
  return fixture
}

/** Retire the merchant authorization the way Identity's command surface does. */
async function revokeMerchantAuthorization(fixture: Fixture): Promise<void> {
  await lease.pool.query(
    `SELECT (
       apply_merchant_ai_transition_v1(
         $1::uuid, 1, 2, $2, $3::uuid, 'revoke', 'revoked',
         ARRAY[]::text[], '{}'::jsonb, 2, 2, 2, 0, 0, $4, $5,
         'google-business-profile-source-policy-v1', 1, 'global',
         'private-beta-global-v1', 'gbp-review-global-v1', $6,
         'organization_closing', $7, $8, now()
       )
     ).*`,
    [
      fixture.lineageId,
      fixture.organizationId,
      fixture.propertyId,
      MERCHANT_AI_NOTICE_VERSION,
      MERCHANT_AI_NOTICE_DIGEST,
      fixture.userId,
      `ai-closure-revoke-${fixture.propertyId}`,
      'c'.repeat(64),
    ],
  )
}

const CLOSURE_STEPS = [
  { state: 'closure_requested', revision: 1, reason: 'test_workspace' },
  { state: 'closing', revision: 2, reason: 'closing_prepared' },
  { state: 'purge_pending', revision: 3, reason: 'recovery_window_elapsed' },
  { state: 'purging', revision: 4, reason: 'irreversible_purge_authorized' },
] as const

type ClosureState = (typeof CLOSURE_STEPS)[number]['state']

function revisionFor(state: ClosureState): number {
  return CLOSURE_STEPS.find((step) => step.state === state)!.revision
}

/**
 * The live authority guards its own edges, revisions and reason codes, so the
 * fixture walks the real state machine instead of writing a state directly.
 */
async function advanceAuthorityTo(
  organizationId: string,
  closureLineageId: string,
  target: ClosureState,
): Promise<void> {
  const current = await lease.pool.query(
    'SELECT revision FROM organization_lifecycle_authority WHERE organization_id = $1',
    [organizationId],
  )
  const currentRevision = (current.rows[0] as { revision: number }).revision
  for (const step of CLOSURE_STEPS) {
    if (step.revision <= currentRevision) continue
    const transitionAt = new Date(REQUESTED_AT.getTime() + step.revision * 1_000)
    if (step.revision === 1) {
      await lease.pool.query(
        `UPDATE organization_lifecycle_authority
         SET state = 'closure_requested', revision = 1, closure_lineage_id = $2,
             closure_requested_at = $3, recoverable_until = $4,
             reactivation_required = true,
             requested_by = 'admin:ai-lifecycle-test',
             request_reason_code = 'test_workspace',
             request_support_evidence_ref = 'test:closure-request',
             last_transition_at = $3, last_actor_id = 'admin:ai-lifecycle-test',
             last_reason_code = 'test_workspace',
             last_support_evidence_ref = 'test:closure-request'
         WHERE organization_id = $1`,
        [organizationId, closureLineageId, REQUESTED_AT, RECOVERABLE_UNTIL],
      )
    } else {
      await lease.pool.query(
        `UPDATE organization_lifecycle_authority
         SET state = $2, revision = $3, last_transition_at = $4,
             irreversible_at = CASE WHEN $2 = 'purging' THEN $4 ELSE irreversible_at END,
             last_actor_id = 'system:lifecycle', last_reason_code = $5,
             last_support_evidence_ref = 'test:phase'
         WHERE organization_id = $1`,
        [organizationId, step.state, step.revision, transitionAt, step.reason],
      )
    }
    if (step.state === target) return
  }
}

async function tableCounts(
  organizationId: string,
): Promise<Readonly<Record<string, number>>> {
  const counts: Record<string, number> = {}
  for (const table of OWNED_TABLES) {
    // Table names come from the frozen list above, never from a caller.
    const result = await lease.pool.query(
      `SELECT count(*)::int AS count FROM ${table} WHERE organization_id = $1`,
      [organizationId],
    )
    counts[table] = (result.rows[0] as { count: number }).count
  }
  return counts
}

async function tableSnapshot(organizationId: string): Promise<string> {
  const parts: string[] = []
  for (const table of OWNED_TABLES) {
    const result = await lease.pool.query(
      `SELECT to_jsonb(t.*)::text AS row FROM ${table} AS t
       WHERE organization_id = $1 ORDER BY to_jsonb(t.*)::text`,
      [organizationId],
    )
    parts.push(
      `${table}:${(result.rows as { row: string }[]).map((row) => row.row).join('|')}`,
    )
  }
  return parts.join('\n')
}

async function deleteReceipts(organizationIds: readonly string[]): Promise<void> {
  if (organizationIds.length === 0) return
  const client = await lease.pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `ALTER TABLE context_organization_lifecycle_receipts
       DISABLE TRIGGER context_organization_lifecycle_receipts_update_delete_guard`,
    )
    await client.query(
      `DELETE FROM context_organization_lifecycle_receipts
       WHERE organization_id = ANY($1::text[])`,
      [organizationIds],
    )
    await client.query(
      `ALTER TABLE context_organization_lifecycle_receipts
       ENABLE ALWAYS TRIGGER context_organization_lifecycle_receipts_update_delete_guard`,
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  // Deleting the Property is the schema's own cascade path for the AI plane,
  // including the head row no statement may delete directly.
  await lease.pool.query('DELETE FROM properties WHERE organization_id = $1', [
    fixture.organizationId,
  ])
  await lease.pool.query('DELETE FROM google_connections WHERE organization_id = $1', [
    fixture.organizationId,
  ])
  await lease.pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [
    fixture.organizationId,
  ])
  await executeWithLastOwnerGuardDisabled(db, [
    sql`DELETE FROM member WHERE "organizationId" = ${fixture.organizationId}`,
  ])
  await deleteReceipts([fixture.organizationId])
  await deleteTestOrganizations(lease.pool, [fixture.organizationId])
  await lease.pool.query('DELETE FROM "user" WHERE id = $1', [fixture.userId])
}

describe.sequential('AI Organization lifecycle contributor', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
    db = drizzle(lease.pool) as Database
  })

  afterAll(async () => {
    await lease.release()
  })

  afterEach(async () => {
    for (const fixture of fixtures) await cleanupFixture(fixture)
    fixtures.length = 0
    await deleteReceipts([...bareOrganizations])
    await deleteTestOrganizations(lease.pool, [...bareOrganizations])
    bareOrganizations.clear()
  })

  it('retires every AI work authority at closing without deleting a row', async () => {
    const fixture = await seedFixture()
    const lineage = randomUUID()
    await advanceAuthorityTo(fixture.organizationId, lineage, 'closure_requested')
    const before = await tableCounts(fixture.organizationId)

    const result = await createAiOrganizationLifecycleContributor(db).prepareClosing(
      contributionRequest(
        fixture.organizationId,
        lineage,
        revisionFor('closure_requested'),
      ),
    )

    expect(result.outcome).toBe('complete')
    // Closing keeps data: not one row left any AI-owned table.
    expect(await tableCounts(fixture.organizationId)).toEqual(before)

    const enrollment = await lease.pool.query(
      `SELECT state, terminal_reason FROM ai_review_analysis_enrollments
       WHERE organization_id = $1`,
      [fixture.organizationId],
    )
    expect(enrollment.rows[0]).toEqual({
      state: 'superseded',
      terminal_reason: 'organization_closing',
    })
    const backfill = await lease.pool.query(
      `SELECT state, terminal_reason FROM ai_review_analysis_backfill_runs
       WHERE organization_id = $1`,
      [fixture.organizationId],
    )
    expect(backfill.rows[0]).toEqual({
      state: 'superseded',
      terminal_reason: 'organization_closing',
    })

    const receipt = await lease.pool.query(
      `SELECT context, phase, outcome, evidence_ref
       FROM context_organization_lifecycle_receipts
       WHERE organization_id = $1`,
      [fixture.organizationId],
    )
    expect(receipt.rows[0]).toMatchObject({
      context: 'ai',
      phase: 'closing',
      outcome: 'complete',
    })
    const evidenceRef = (receipt.rows[0] as { evidence_ref: string }).evidence_ref
    for (const marker of Object.values(MARKERS)) {
      expect(evidenceRef).not.toContain(marker)
    }
    expect(evidenceRef).not.toContain(fixture.propertyId)
  })

  it('replays a recorded closing receipt exactly once', async () => {
    const fixture = await seedFixture()
    const lineage = randomUUID()
    await advanceAuthorityTo(fixture.organizationId, lineage, 'closure_requested')
    const contributor = createAiOrganizationLifecycleContributor(db)
    const request = contributionRequest(
      fixture.organizationId,
      lineage,
      revisionFor('closure_requested'),
    )

    const first = await contributor.prepareClosing(request)
    expect(await contributor.prepareClosing(request)).toEqual(first)

    const receipts = await lease.pool.query(
      `SELECT count(*)::int AS count FROM context_organization_lifecycle_receipts
       WHERE organization_id = $1 AND phase = 'closing'`,
      [fixture.organizationId],
    )
    expect(receipts.rows[0]).toEqual({ count: 1 })
  })

  it('answers no_data for an Organization that never authorized AI', async () => {
    const organizationId = await seedBareOrganization()
    const lineage = randomUUID()
    await advanceAuthorityTo(organizationId, lineage, 'closure_requested')

    const result = await createAiOrganizationLifecycleContributor(db).prepareClosing(
      contributionRequest(organizationId, lineage, revisionFor('closure_requested')),
    )

    expect(result.outcome).toBe('no_data')
    const receipt = await lease.pool.query(
      `SELECT outcome FROM context_organization_lifecycle_receipts
       WHERE organization_id = $1 AND context = 'ai'`,
      [organizationId],
    )
    // Affirmative absence is recorded; an omitted contributor would make a
    // partial purge look complete.
    expect(receipt.rows).toEqual([{ outcome: 'no_data' }])
  })

  it('refuses readiness while the merchant authorization is live, and mutates nothing', async () => {
    const fixture = await seedFixture()
    const lineage = randomUUID()
    await advanceAuthorityTo(fixture.organizationId, lineage, 'closing')
    const before = await tableSnapshot(fixture.organizationId)

    const failure = await createAiOrganizationLifecycleContributor(db)
      .verifyPurgeReadiness(
        contributionRequest(fixture.organizationId, lineage, revisionFor('closing')),
      )
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(AiPurgeReadinessBlockedError)
    expect((failure as AiPurgeReadinessBlockedError).blockers).toEqual([
      { code: 'enabled_authorizations', count: 1 },
      { code: 'active_enrollments', count: 1 },
      { code: 'running_backfills', count: 1 },
      { code: 'unreleased_execution_permits', count: 1 },
    ])
    // Read only: the full contents of every AI-owned table are unchanged.
    expect(await tableSnapshot(fixture.organizationId)).toEqual(before)
    const receipts = await lease.pool.query(
      `SELECT count(*)::int AS count FROM context_organization_lifecycle_receipts
       WHERE organization_id = $1`,
      [fixture.organizationId],
    )
    expect(receipts.rows[0]).toEqual({ count: 0 })
  })

  it('accepts readiness once the authorization is retired and admission has drained', async () => {
    const fixture = await seedFixture()
    const lineage = randomUUID()
    await advanceAuthorityTo(fixture.organizationId, lineage, 'closure_requested')
    const contributor = createAiOrganizationLifecycleContributor(db)
    await contributor.prepareClosing(
      contributionRequest(
        fixture.organizationId,
        lineage,
        revisionFor('closure_requested'),
      ),
    )
    await revokeMerchantAuthorization(fixture)
    await lease.pool.query(
      `UPDATE ai_execution_permits SET state = 'released' WHERE id = $1`,
      [fixture.permitId],
    )
    await advanceAuthorityTo(fixture.organizationId, lineage, 'closing')
    const before = await tableSnapshot(fixture.organizationId)

    const result = await contributor.verifyPurgeReadiness(
      contributionRequest(fixture.organizationId, lineage, revisionFor('closing')),
    )

    expect(result.outcome).toBe('complete')
    expect(await tableSnapshot(fixture.organizationId)).toEqual(before)
  })

  it('erases derivatives unresurrectably, keeps consent evidence, and converges on replay', async () => {
    const fixture = await seedFixture()
    const neighbour = await seedFixture()
    const lineage = randomUUID()
    await advanceAuthorityTo(fixture.organizationId, lineage, 'purging')
    const neighbourBefore = await tableSnapshot(neighbour.organizationId)
    const contributor = createAiOrganizationLifecycleContributor(db)
    const request = contributionRequest(
      fixture.organizationId,
      lineage,
      revisionFor('purging'),
    )

    const result = await contributor.purge(request)
    expect(result.outcome).toBe('complete')

    const counts = await tableCounts(fixture.organizationId)
    for (const table of PURGED_TABLES) expect(counts[table]).toBe(0)
    // Independently retained consent history survives the irreversible boundary.
    expect(counts.merchant_ai_consent_evidence).toBeGreaterThan(0)
    expect(counts.merchant_ai_enablement).toBe(1)

    // No derivative text survives anywhere this context owns.
    const surviving = await tableSnapshot(fixture.organizationId)
    for (const marker of Object.values(MARKERS)) {
      expect(surviving).not.toContain(marker)
    }

    // Unresurrectable: the real read path finds nothing to serve or export,
    // because the cursors and heads a rebuild would need went with it.
    const exported = await createAiOrganizationExportContributor(db).contribute({
      organizationId: fixture.organizationId,
      requestId: randomUUID(),
      asOf: new Date(Date.now() - 1_000),
    })
    expect(exported.coverage).toBe('no_data')
    expect(exported.entries).toEqual([])

    // A neighbouring tenant is byte-identical.
    expect(await tableSnapshot(neighbour.organizationId)).toEqual(neighbourBefore)

    // Idempotent: the replayed receipt is returned and nothing moves.
    expect(await contributor.purge(request)).toEqual(result)
    expect(await tableCounts(fixture.organizationId)).toEqual(counts)
    const receipts = await lease.pool.query(
      `SELECT count(*)::int AS count FROM context_organization_lifecycle_receipts
       WHERE organization_id = $1 AND phase = 'purge'`,
      [fixture.organizationId],
    )
    expect(receipts.rows[0]).toEqual({ count: 1 })
  })
})
