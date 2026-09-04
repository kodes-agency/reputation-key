import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { withLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { organizationId, propertyId } from '#/shared/domain/ids'
import {
  AI_REVIEW_ANALYSIS_ENROLLMENT_SAFETY_CEILING,
  EMPTY_REVIEW_ANALYSIS_REVISION_SET_DIGEST,
} from '../../application/ports/ai-review-analysis-enrollment.port'
import { createReviewAnalysisEnrollmentAdapter } from './ai-review-analysis-enrollment.adapter'
import { createAiAuthorizationErasureAdapter } from './ai-authorization-erasure.adapter'
import {
  AI_AUTHORIZATION_ERASURE_LEASE_MILLIS,
  AI_AUTHORIZATION_ERASURE_MAX_ATTEMPTS,
} from '../../application/use-cases/erase-ai-authorization-derivatives'

const db = getDb()
let cleanupPool: Pool

const ORGANIZATION_ID = organizationId('31000000-0000-4000-8000-000000000001')
const PROPERTY_ID = propertyId('31000000-0000-4000-8000-000000000002')
const CONNECTION_ID = '31000000-0000-4000-8000-000000000003'
const USER_ID = 'ai-enrollment-adapter-user'
const LINEAGE_ID = '31000000-0000-4000-8000-000000000004'
const EVENT_ID = '31000000-0000-4000-8000-000000000005'
const CORRELATION_ID = '31000000-0000-4000-8000-000000000006'
const REVIEW_ID = '31000000-0000-4000-8000-000000000007'
const QUALIFIED_EVENT_ID = '31000000-0000-4000-8000-000000000008'
const CHANGE_EVENT_ID = '31000000-0000-4000-8000-000000000009'
const REVOKE_EVENT_ID = '31000000-0000-4000-8000-00000000000a'
const STALE_EVENT_ID = '31000000-0000-4000-8000-00000000000b'
const RESTORE_EVENT_ID = '31000000-0000-4000-8000-00000000000c'
const RESTORE_LINEAGE_ID = '31000000-0000-4000-8000-00000000000d'
const ERASURE_LEASE_OWNER_A = '31000000-0000-4000-8000-00000000000e'
const ERASURE_LEASE_OWNER_B = '31000000-0000-4000-8000-00000000000f'
const ANALYSIS_OPERATION_ID = '31000000-0000-4000-8000-000000000010'
const TREND_SCHEDULE_ID = '31000000-0000-4000-8000-000000000011'
const TREND_OUTBOX_ID = '31000000-0000-4000-8000-000000000012'
const REENABLE_EVENT_ID = '31000000-0000-4000-8000-000000000013'
const AUTHORIZED_AT = new Date('2026-08-27T08:00:00.000Z')
const enrollmentMigration = readFileSync(
  join(process.cwd(), 'drizzle/0137_ai_review_analysis_enrollment.sql'),
  'utf8',
)
const lifecycleMigration = readFileSync(
  join(process.cwd(), 'drizzle/0145_ai_authorization_lifecycle.sql'),
  'utf8',
)

const fence = (analysisStartSequence: number) => ({
  authorizationLineageId: LINEAGE_ID,
  authorizationStateVersion: 1,
  sourceEpoch: 0,
  reviewAnalysisEpoch: 1,
  analysisStartSequence,
})

function appliedEnrollmentId(
  result: Awaited<
    ReturnType<
      ReturnType<
        typeof createReviewAnalysisEnrollmentAdapter
      >['applyAuthorizationLifecycle']
    >
  >,
): string {
  return result.status === 'applied' &&
    (result.enrollment.status === 'queued' ||
      result.enrollment.status === 'awaiting_assisted_approval' ||
      result.enrollment.status === 'duplicate')
    ? (result.enrollment.enrollmentId ?? '')
    : ''
}

async function cleanup(): Promise<void> {
  await db.execute(sql`
    DELETE FROM ai_authorization_lifecycle_records
    WHERE organization_id = ${ORGANIZATION_ID}
  `)
  await db.execute(
    sql`DELETE FROM outbox_events WHERE organization_id = ${ORGANIZATION_ID}`,
  )
  await db.execute(sql`DELETE FROM properties WHERE id = ${PROPERTY_ID}::uuid`)
  await db.execute(sql`DELETE FROM google_connections WHERE id = ${CONNECTION_ID}::uuid`)
  await withLastOwnerGuardDisabled(cleanupPool, async (client) => {
    await client.query('DELETE FROM member WHERE "organizationId" = $1', [
      ORGANIZATION_ID,
    ])
    await client.query('DELETE FROM "user" WHERE id = $1', [USER_ID])
    await deleteTestOrganizations(client, [ORGANIZATION_ID])
  })
}

async function seed(analysisStartSequence: number): Promise<void> {
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORGANIZATION_ID}, 'AI Enrollment Adapter', ${ORGANIZATION_ID}, now())
  `)
  await db.execute(sql`
    INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
    VALUES (
      ${USER_ID}, 'AI Enrollment Adapter',
      'ai-enrollment-adapter@example.test', true, now(), now()
    )
  `)
  await db.execute(sql`
    INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
    VALUES (
      'member-ai-enrollment-adapter', ${USER_ID}, ${ORGANIZATION_ID},
      'admin', now()
    )
  `)
  await db.execute(sql`
    INSERT INTO google_connections (
      id, organization_id, google_subject, encrypted_access_token,
      encrypted_refresh_token, token_expires_at, scopes, connected_by,
      visibility, status
    ) VALUES (
      ${CONNECTION_ID}::uuid, ${ORGANIZATION_ID}, 'ai-enrollment-subject',
      'encrypted-access', 'encrypted-refresh', now() + interval '1 hour',
      ARRAY['https://www.googleapis.com/auth/business.manage'], ${USER_ID},
      'organization', 'active'
    )
  `)
  await db.execute(sql`
    INSERT INTO properties (
      id, organization_id, name, slug, timezone, lifecycle_state,
      google_connection_id, gbp_account_id, gbp_location_id,
      google_binding_state, profile_source, routing_policy_version,
      processing_region, source_epoch
    ) VALUES (
      ${PROPERTY_ID}::uuid, ${ORGANIZATION_ID}, 'Enrollment Property',
      'enrollment-property', 'UTC', 'active', ${CONNECTION_ID}::uuid,
      'account-enrollment', 'location-enrollment', 'active', 'legacy',
      1, 'global', 0
    )
  `)
  await db.execute(sql`
    INSERT INTO review_ai_analysis_heads (
      organization_id, property_id, source_epoch, head_sequence
    ) VALUES (
      ${ORGANIZATION_ID}, ${PROPERTY_ID}::uuid, 0, ${analysisStartSequence}
    )
  `)
  await db.execute(sql`
    INSERT INTO property_access_grant (
      organization_id, property_id, user_id, source, created_by
    ) VALUES (
      ${ORGANIZATION_ID}, ${PROPERTY_ID}::uuid, ${USER_ID},
      'operator', ${USER_ID}
    )
  `)
  if (analysisStartSequence === 1) {
    await db.execute(sql`
      INSERT INTO reviews (
        id, organization_id, property_id, platform, external_id,
        reviewer_name, rating, text, language_code, reviewed_at,
        content_expires_at, source_epoch, source_revision,
        analysis_sequence, ai_source_byte_length, ai_source_digest
      ) VALUES (
        ${REVIEW_ID}::uuid, ${ORGANIZATION_ID}, ${PROPERTY_ID}::uuid,
        'google', 'enrollment-review-1', 'Ada', 5, 'Excellent stay',
        'en', '2026-08-20T10:00:00.000Z'::timestamptz,
        '2027-08-20T10:00:00.000Z'::timestamptz, 0, 1, 1, 20,
        ${'a'.repeat(64)}
      )
    `)
    await db.execute(sql`
      INSERT INTO material_review_revisions (
        review_id, revision, organization_id, property_id, source_epoch,
        normalization_version, source_digest, normalized_digest, rating,
        normalized_text, content_state
      ) VALUES (
        ${REVIEW_ID}::uuid, 1, ${ORGANIZATION_ID}, ${PROPERTY_ID}::uuid, 0,
        'legacy-unverified-v0', NULL, NULL, 5, 'Excellent stay', 'active'
      )
    `)
  } else if (analysisStartSequence > 1) {
    await db.execute(sql`
      INSERT INTO reviews (
        id, organization_id, property_id, platform, external_id,
        reviewer_name, rating, text, language_code, reviewed_at,
        content_expires_at, source_epoch, source_revision,
        analysis_sequence, ai_source_byte_length, ai_source_digest
      )
      SELECT (
          '32000000-0000-4000-8000-' || lpad(candidate::text, 12, '0')
        )::uuid,
        ${ORGANIZATION_ID}, ${PROPERTY_ID}::uuid, 'google',
        'enrollment-bulk-' || candidate::text, 'Guest', 5,
        'Eligible review', 'en',
        '2026-08-20T10:00:00.000Z'::timestamptz
          + candidate * interval '1 millisecond',
        '2027-08-20T10:00:00.000Z'::timestamptz,
        0, 1, candidate, 15, ${'c'.repeat(64)}
      FROM generate_series(1, ${analysisStartSequence}) AS candidate
    `)
    await db.execute(sql`
      INSERT INTO material_review_revisions (
        review_id, revision, organization_id, property_id, source_epoch,
        normalization_version, source_digest, normalized_digest, rating,
        normalized_text, content_state
      )
      SELECT review.id, 1, review.organization_id, review.property_id,
             review.source_epoch, 'legacy-unverified-v0', NULL, NULL,
             review.rating, review.text, 'active'
      FROM reviews AS review
      WHERE review.organization_id = ${ORGANIZATION_ID}
        AND review.property_id = ${PROPERTY_ID}::uuid
    `)
  }
  await db.execute(sql`
    SELECT (
      apply_merchant_ai_transition_v1(
        ${LINEAGE_ID}::uuid, 0, 1, ${ORGANIZATION_ID}, ${PROPERTY_ID}::uuid,
        'enable', 'enabled', ARRAY['review_analysis']::text[],
        '{"review_analysis":"review-analysis-runtime-v1"}'::jsonb,
        1, 1, 1, 0, ${analysisStartSequence}, ${MERCHANT_AI_NOTICE_VERSION},
        ${MERCHANT_AI_NOTICE_DIGEST}, 'google-business-profile-source-policy-v1',
        1, 'global', 'private-beta-global-v1', 'gbp-review-global-v1',
        ${USER_ID}, 'merchant_enabled', 'ai-enrollment-adapter-enable',
        ${'b'.repeat(64)}, ${AUTHORIZED_AT}
      )
    ).*
  `)
  await db.execute(sql`
    INSERT INTO outbox_events (
      id, event_type, event_version, payload, organization_id, property_id,
      source_context, source_aggregate_id, created_at
    ) VALUES (
      ${EVENT_ID}::uuid, 'identity.merchant_ai.changed', 1,
      '{}'::jsonb, ${ORGANIZATION_ID}, ${PROPERTY_ID}, 'identity',
      ${PROPERTY_ID}, ${AUTHORIZED_AT}
    )
  `)
}

function trigger(analysisStartSequence: number) {
  return {
    eventEnvelopeId: EVENT_ID,
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    authorizationState: 'enabled' as const,
    fence: {
      ...fence(analysisStartSequence),
      replyDraftingEpoch: 1,
      propertyTrendsEpoch: 1,
    },
    correlationId: null,
    occurredAt: AUTHORIZED_AT,
  }
}

type AuthorizationTransitionInput = Readonly<{
  eventId: string
  lineageId: string
  expectedStateVersion: number
  stateVersion: number
  transitionKind: 'enable' | 'change' | 'revoke' | 'restore_reset'
  state: 'disabled' | 'enabled' | 'revoked'
  capabilities: ReadonlyArray<'review_analysis' | 'reply_drafting' | 'property_trends'>
  reviewAnalysisEpoch: number
  replyDraftingEpoch: number
  propertyTrendsEpoch: number
  analysisStartSequence?: number
  occurredAt: Date
}>

async function applyIdentityTransition(input: AuthorizationTransitionInput) {
  const capabilityArray = `{${input.capabilities.join(',')}}`
  const runtimeProfiles = Object.fromEntries(
    input.capabilities.map((capability) => [
      capability,
      capability === 'review_analysis'
        ? 'review-analysis-runtime-v1'
        : capability === 'reply_drafting'
          ? 'reply-drafting-runtime-v1'
          : 'property-trends-runtime-v1',
    ]),
  )
  await db.execute(sql`
    SELECT (
      apply_merchant_ai_transition_v1(
        ${input.lineageId}::uuid, ${input.expectedStateVersion},
        ${input.stateVersion}, ${ORGANIZATION_ID}, ${PROPERTY_ID}::uuid,
        ${input.transitionKind}, ${input.state}, ${capabilityArray}::text[],
        ${JSON.stringify(runtimeProfiles)}::jsonb,
        ${input.reviewAnalysisEpoch}, ${input.replyDraftingEpoch},
        ${input.propertyTrendsEpoch}, 0, ${input.analysisStartSequence ?? 0}, ${MERCHANT_AI_NOTICE_VERSION},
        ${MERCHANT_AI_NOTICE_DIGEST}, 'google-business-profile-source-policy-v1',
        1, 'global', 'private-beta-global-v1', 'gbp-review-global-v1',
        ${input.transitionKind === 'restore_reset' ? 'restore-controller' : USER_ID},
        ${input.transitionKind === 'revoke' ? 'merchant_revoked' : input.transitionKind === 'restore_reset' ? 'restore_reset' : 'capabilities_changed'},
        ${`ai-lifecycle-${input.eventId}`}, ${'d'.repeat(64)}, ${input.occurredAt}
      )
    ).*
  `)
  const payload = {
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    authorizationLineageId: input.lineageId,
    state: input.state,
    reviewAnalysisEpoch: input.reviewAnalysisEpoch,
    replyDraftingEpoch: input.replyDraftingEpoch,
    propertyTrendsEpoch: input.propertyTrendsEpoch,
    authorizedSourceEpoch: 0,
    analysisStartSequence: input.analysisStartSequence ?? 0,
    stateVersion: input.stateVersion,
    occurredAt: input.occurredAt.toISOString(),
    correlationId: null,
  }
  await db.execute(sql`
    INSERT INTO outbox_events (
      id, event_type, event_version, payload, organization_id, property_id,
      source_context, source_aggregate_id, created_at
    ) VALUES (
      ${input.eventId}::uuid, 'identity.merchant_ai.changed', 1,
      ${JSON.stringify(payload)}::jsonb, ${ORGANIZATION_ID}, ${PROPERTY_ID},
      'identity', ${PROPERTY_ID}, ${input.occurredAt}
    )
  `)
  return {
    eventEnvelopeId: input.eventId,
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    authorizationState: input.state,
    fence: {
      authorizationLineageId: input.lineageId,
      authorizationStateVersion: input.stateVersion,
      sourceEpoch: 0,
      reviewAnalysisEpoch: input.reviewAnalysisEpoch,
      replyDraftingEpoch: input.replyDraftingEpoch,
      propertyTrendsEpoch: input.propertyTrendsEpoch,
      analysisStartSequence: input.analysisStartSequence ?? 0,
    },
    correlationId: null,
    occurredAt: input.occurredAt,
  } as const
}

async function executeUpgradeReplayAndSeed(): Promise<void> {
  const start = enrollmentMigration.indexOf('-- AI-02 CURRENT AUTHORIZATION REPLAY BEGIN')
  const end = enrollmentMigration.indexOf('-- AI-02 CURRENT ENROLLMENT SEED END')
  const replaySql = enrollmentMigration
    .slice(start, end)
    .replace(/^--.*$/gmu, '')
    .replace(/--> statement-breakpoint/g, '')

  await cleanupPool.query(replaySql)
}

async function executeLifecycleUpgradeSeed(): Promise<void> {
  const start = lifecycleMigration.indexOf(
    '-- Every existing current authorization receives a fresh identifier-only replay.',
  )
  if (start < 0) throw new Error('AI lifecycle upgrade seed marker is absent')
  await cleanupPool.query(
    lifecycleMigration.slice(start).replace(/--> statement-breakpoint/g, ''),
  )
}

async function createAllClassRetirement() {
  await seed(1)
  const lifecycle = createReviewAnalysisEnrollmentAdapter(db, randomUUID)
  await lifecycle.applyAuthorizationLifecycle(trigger(1))
  const enabledAll = await applyIdentityTransition({
    eventId: CHANGE_EVENT_ID,
    lineageId: LINEAGE_ID,
    expectedStateVersion: 1,
    stateVersion: 2,
    transitionKind: 'change',
    state: 'enabled',
    capabilities: ['review_analysis', 'reply_drafting', 'property_trends'],
    reviewAnalysisEpoch: 1,
    replyDraftingEpoch: 2,
    propertyTrendsEpoch: 2,
    analysisStartSequence: 1,
    occurredAt: new Date('2026-08-27T09:00:00.000Z'),
  })
  await lifecycle.applyAuthorizationLifecycle(enabledAll)
  const revokedAt = new Date('2026-08-27T10:00:00.000Z')
  const revoked = await applyIdentityTransition({
    eventId: REVOKE_EVENT_ID,
    lineageId: LINEAGE_ID,
    expectedStateVersion: 2,
    stateVersion: 3,
    transitionKind: 'revoke',
    state: 'revoked',
    capabilities: [],
    reviewAnalysisEpoch: 2,
    replyDraftingEpoch: 3,
    propertyTrendsEpoch: 3,
    analysisStartSequence: 1,
    occurredAt: revokedAt,
  })
  const result = await lifecycle.applyAuthorizationLifecycle(revoked)
  if (result.status !== 'applied') throw new Error('retirement was not applied')
  return { lifecycleId: result.lifecycle.id, revokedAt }
}

async function seedRetiredDerivatives(): Promise<void> {
  const controls = await db.execute(sql`
    SELECT scope_key, control_id, generation
    FROM ai_execution_control_heads
    WHERE scope_key IN (
      'global', 'provider:private-beta-global-v1',
      'capability:review_analysis'
    )
  `)
  const control = (scopeKey: string) => {
    const row = controls.rows.find((candidate) => candidate.scope_key === scopeKey)
    if (!row) throw new Error(`missing AI control ${scopeKey}`)
    return row
  }
  const global = control('global')
  const provider = control('provider:private-beta-global-v1')
  const capability = control('capability:review_analysis')
  const generatedAt = new Date('2026-08-27T09:30:00.000Z')
  await db.execute(sql`
    INSERT INTO ai_operations (
      id, idempotency_scope, idempotency_key, request_fingerprint,
      source_digest, source_byte_count, command, capability,
      organization_id, property_id, system_principal, review_id,
      origin_event_id, subject_hmac, subject_hmac_key_version,
      source_epoch, source_revision, reviewed_at_epoch_millis,
      analysis_sequence, authorization_lineage_id,
      provider_deployment_profile_version, operation_profile_version,
      capability_runtime_profile_version, global_control_id,
      global_control_generation, provider_control_id,
      provider_control_generation, capability_control_id,
      capability_control_generation, capability_fences, state,
      execution_attempt, created_at, updated_at, expires_at
    ) VALUES (
      ${ANALYSIS_OPERATION_ID}::uuid, 'ai-erasure-test', 'retired-analysis',
      ${'1'.repeat(64)}, ${'2'.repeat(64)}, 20, 'analysis',
      'review_analysis', ${ORGANIZATION_ID}, ${PROPERTY_ID}::uuid,
      'review_event_consumer', ${REVIEW_ID}::uuid, ${EVENT_ID}::uuid,
      ${'3'.repeat(64)}, 'test-v1', 0, 1, ${generatedAt.getTime()}, 1,
      ${LINEAGE_ID}::uuid, 'private-beta-global-v1', 'review-analysis-v1',
      'review-analysis-runtime-v1', ${String(global.control_id)}::uuid,
      ${Number(global.generation)}, ${String(provider.control_id)}::uuid,
      ${Number(provider.generation)}, ${String(capability.control_id)}::uuid,
      ${Number(capability.generation)},
      '{"capability":"review_analysis","reviewAnalysisEpoch":"1"}'::jsonb,
      'succeeded', 1, ${generatedAt}, ${generatedAt},
      ${new Date(generatedAt.getTime() + 60_000)}
    )
  `)
  await db.execute(sql`
    INSERT INTO ai_review_analyses (
      organization_id, property_id, review_id, source_epoch, source_revision,
      analysis_sequence, operation_id, authorization_lineage_id,
      review_analysis_epoch, property_profile_version,
      analysis_profile_version, status, unavailable_reason, sentiment,
      primary_category, attention, generated_at, expires_at
    ) VALUES (
      ${ORGANIZATION_ID}, ${PROPERTY_ID}::uuid, ${REVIEW_ID}::uuid, 0, 1, 1,
      ${ANALYSIS_OPERATION_ID}::uuid, ${LINEAGE_ID}::uuid, 1, 1,
      'review-analysis-v1', 'ready', NULL, 'positive', 'service', 'low',
      ${generatedAt}, ${new Date(generatedAt.getTime() + 24 * 60 * 60 * 1_000)}
    )
  `)
  await db.execute(sql`
    INSERT INTO ai_property_aggregate_contributions (
      organization_id, property_id, review_id, source_epoch, source_revision,
      analysis_sequence, review_analysis_epoch, property_profile_version,
      calendar_profile_version, local_date, status, rating, sentiment,
      primary_category, attention, applied_aggregate_revision, applied_at
    ) VALUES (
      ${ORGANIZATION_ID}, ${PROPERTY_ID}::uuid, ${REVIEW_ID}::uuid, 0, 1, 1,
      1, 1, 'property-calendar-v1', '2026-08-27', 'ready', 5,
      'positive', 'service', 'low', 1, ${generatedAt}
    )
  `)
  await db.execute(sql`
    INSERT INTO ai_property_aggregate_heads (
      organization_id, property_id, source_epoch, review_analysis_epoch,
      property_profile_version, aggregate_revision,
      terminal_analysis_sequence, updated_at
    ) VALUES (
      ${ORGANIZATION_ID}, ${PROPERTY_ID}::uuid, 0, 1, 1, 1, 1, ${generatedAt}
    )
  `)
  await db.execute(sql`
    INSERT INTO ai_property_daily_aggregates (
      organization_id, property_id, local_date, source_epoch,
      review_analysis_epoch, property_profile_version,
      calendar_profile_version, aggregate_revision,
      terminal_analysis_sequence, review_count, rating_sum,
      positive_count, neutral_count, negative_count, mixed_count,
      service_count, staff_count, quality_count, value_count,
      cleanliness_count, wait_time_count, atmosphere_count, location_count,
      accessibility_count, other_count, urgent_count, high_count,
      medium_count, low_count, updated_at
    ) VALUES (
      ${ORGANIZATION_ID}, ${PROPERTY_ID}::uuid, '2026-08-27', 0, 1, 1,
      'property-calendar-v1', 1, 1, 1, 5, 1, 0, 0, 0, 1, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 1, ${generatedAt}
    )
  `)
  await db.execute(sql`
    INSERT INTO ai_property_trend_schedules (
      id, outbox_event_id, organization_id, property_id, due_local_date,
      source_epoch, review_analysis_epoch, property_trends_epoch,
      property_profile_version, terminal_analysis_sequence,
      aggregate_revision, timezone, calendar_profile_version,
      report_profile_version, scheduler_generation, scheduled_at
    ) VALUES (
      ${TREND_SCHEDULE_ID}::uuid, ${TREND_OUTBOX_ID}::uuid,
      ${ORGANIZATION_ID}, ${PROPERTY_ID}::uuid, '2026-08-27', 0, 1, 2, 1,
      1, 1, 'UTC', 'property-calendar-v1', 'property-trend-v1', 1,
      ${generatedAt}
    )
  `)
  await db.execute(sql`
    INSERT INTO ai_property_trend_outcomes (
      schedule_id, organization_id, property_id, disposition,
      selected_signal_ids, signal_key, direction, confidence_basis_points,
      supporting_review_count, headline, sentences, summary,
      render_profile_version, render_profile_digest, recorded_at, expires_at
    ) VALUES (
      ${TREND_SCHEDULE_ID}::uuid, ${ORGANIZATION_ID}, ${PROPERTY_ID}::uuid,
      'ready', '["category.service"]'::jsonb, 'category.service', 'improving',
      1500, 1, 'Review signals improved', '["Service improved."]'::jsonb,
      'Service improved.', 'trend-render-v1', ${'4'.repeat(64)},
      ${generatedAt}, ${new Date(generatedAt.getTime() + 24 * 60 * 60 * 1_000)}
    )
  `)
}

beforeAll(async () => {
  cleanupPool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 1 })
  await cleanup()
})

beforeEach(cleanup)
afterAll(async () => {
  await cleanup()
  await cleanupPool.end()
})

describe('Review Analysis enrollment adapter', () => {
  it('seeds exact enrollment authority and its identifier-only upgrade event', async () => {
    await seed(1)
    await executeUpgradeReplayAndSeed()

    const events = await db.execute(sql`
      SELECT id, event_type, event_version, payload, published_at
      FROM outbox_events
      WHERE organization_id = ${ORGANIZATION_ID}
        AND id <> ${EVENT_ID}::uuid
    `)
    expect(events.rows).toEqual([
      expect.objectContaining({
        event_type: 'identity.merchant_ai.changed',
        event_version: 1,
        published_at: null,
        payload: expect.objectContaining({
          organizationId: ORGANIZATION_ID,
          propertyId: PROPERTY_ID,
          authorizationLineageId: LINEAGE_ID,
          state: 'enabled',
          reviewAnalysisEpoch: 1,
          authorizedSourceEpoch: 0,
          analysisStartSequence: 1,
          stateVersion: 1,
          correlationId: null,
        }),
      }),
    ])

    const enrollment = await db.execute(sql`
      SELECT enrollment.id, enrollment.trigger_event_envelope_id,
             enrollment.state, enrollment.snapshot_revision_count,
             enrollment.snapshot_revision_set_digest,
             enrollment.enrolled_revision_count,
             membership.ordinal, membership.review_id,
             membership.source_revision, membership.analysis_sequence
      FROM ai_review_analysis_enrollments AS enrollment
      JOIN ai_review_analysis_enrollment_memberships AS membership
        ON membership.enrollment_id = enrollment.id
      WHERE enrollment.organization_id = ${ORGANIZATION_ID}
        AND enrollment.property_id = ${PROPERTY_ID}::uuid
    `)
    expect(enrollment.rows).toEqual([
      expect.objectContaining({
        trigger_event_envelope_id: events.rows[0]?.id,
        state: 'queued',
        snapshot_revision_count: '1',
        enrolled_revision_count: '0',
        ordinal: '0',
        review_id: REVIEW_ID,
        source_revision: '1',
        analysis_sequence: '1',
      }),
    ])
    expect(enrollment.rows[0]?.snapshot_revision_set_digest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('seeds lifecycle evidence before a rolling worker can receipt its content-free replay', async () => {
    await seed(1)
    await executeLifecycleUpgradeSeed()

    const events = await db.execute(sql`
      SELECT id, payload
      FROM outbox_events
      WHERE organization_id = ${ORGANIZATION_ID}
        AND id <> ${EVENT_ID}::uuid
    `)
    expect(events.rows).toHaveLength(1)
    const upgradeEvent = events.rows[0]
    if (!upgradeEvent) throw new Error('AI lifecycle upgrade event is absent')
    expect(Object.keys(upgradeEvent.payload as Record<string, unknown>).sort()).toEqual([
      'analysisStartSequence',
      'authorizationLineageId',
      'authorizedSourceEpoch',
      'correlationId',
      'occurredAt',
      'organizationId',
      'propertyId',
      'propertyTrendsEpoch',
      'replyDraftingEpoch',
      'reviewAnalysisEpoch',
      'state',
      'stateVersion',
    ])

    const adapter = createReviewAnalysisEnrollmentAdapter(db, randomUUID)
    const seeded = await adapter.readCurrentLifecycle({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
    })
    expect(seeded).toMatchObject({
      eventEnvelopeId: String(upgradeEvent.id),
      authorizationState: 'enabled',
      authorizedCapabilities: ['review_analysis'],
      visibleDataClasses: ['review_analysis', 'property_aggregate'],
      retiredDataClasses: [],
      erasureStatus: 'not_required',
      erasureDeadlineEpochMillis: null,
    })

    await expect(
      adapter.applyAuthorizationLifecycle({
        ...trigger(1),
        eventEnvelopeId: String(upgradeEvent.id),
      }),
    ).resolves.toMatchObject({
      status: 'applied',
      lifecycle: { id: seeded?.id },
      enrollment: { status: 'queued' },
    })
    const receipt = await db.execute(sql`
      SELECT status
      FROM event_consumer_receipts
      WHERE event_id = ${String(upgradeEvent.id)}::uuid
        AND consumer_name = 'ai.enroll-review-analysis'
    `)
    expect(receipt.rows).toEqual([{ status: 'applied' }])
  })

  it('seeds the overdue-safe erasure obligation for a previously unobserved revoke', async () => {
    await seed(1)
    await applyIdentityTransition({
      eventId: CHANGE_EVENT_ID,
      lineageId: LINEAGE_ID,
      expectedStateVersion: 1,
      stateVersion: 2,
      transitionKind: 'change',
      state: 'enabled',
      capabilities: ['review_analysis', 'reply_drafting', 'property_trends'],
      reviewAnalysisEpoch: 1,
      replyDraftingEpoch: 2,
      propertyTrendsEpoch: 2,
      analysisStartSequence: 1,
      occurredAt: new Date('2026-08-27T09:00:00.000Z'),
    })
    const revokedAt = new Date('2026-08-27T10:00:00.000Z')
    await applyIdentityTransition({
      eventId: REVOKE_EVENT_ID,
      lineageId: LINEAGE_ID,
      expectedStateVersion: 2,
      stateVersion: 3,
      transitionKind: 'revoke',
      state: 'revoked',
      capabilities: [],
      reviewAnalysisEpoch: 2,
      replyDraftingEpoch: 3,
      propertyTrendsEpoch: 3,
      analysisStartSequence: 1,
      occurredAt: revokedAt,
    })

    await executeLifecycleUpgradeSeed()

    await expect(
      createReviewAnalysisEnrollmentAdapter(db, randomUUID).readCurrentLifecycle({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
      }),
    ).resolves.toMatchObject({
      authorizationState: 'revoked',
      transitionKind: 'revoke',
      visibleDataClasses: [],
      retiredDataClasses: ['review_analysis', 'property_aggregate', 'property_trend'],
      erasureStatus: 'pending',
      erasureDeadlineEpochMillis: revokedAt.getTime() + 24 * 60 * 60 * 1_000,
    })
  })

  it('seeds an explicit canonical empty snapshot for a zero-review property', async () => {
    await seed(0)
    await executeUpgradeReplayAndSeed()

    const enrollment = await db.execute(sql`
      SELECT snapshot_revision_count, snapshot_revision_set_digest,
             enrolled_revision_count
      FROM ai_review_analysis_enrollments
      WHERE organization_id = ${ORGANIZATION_ID}
        AND property_id = ${PROPERTY_ID}::uuid
    `)
    expect(enrollment.rows).toEqual([
      {
        snapshot_revision_count: '0',
        snapshot_revision_set_digest: EMPTY_REVIEW_ANALYSIS_REVISION_SET_DIGEST,
        enrolled_revision_count: '0',
      },
    ])
    const members = await db.execute(sql`
      SELECT count(*)::integer AS count
      FROM ai_review_analysis_enrollment_memberships
      WHERE organization_id = ${ORGANIZATION_ID}
        AND property_id = ${PROPERTY_ID}::uuid
    `)
    expect(members.rows).toEqual([{ count: 0 }])
  })

  it('durably proves the explicit zero-review frontier without synthetic work', async () => {
    await seed(0)
    const adapter = createReviewAnalysisEnrollmentAdapter(db, randomUUID)

    const applied = await adapter.applyAuthorizationLifecycle(trigger(0))
    expect(applied).toMatchObject({
      status: 'applied',
      enrollment: { status: 'queued' },
    })
    const enrollmentId = appliedEnrollmentId(applied)

    const captured = await db.execute(sql`
      SELECT snapshot_revision_count, snapshot_revision_set_digest,
             enrolled_revision_count
      FROM ai_review_analysis_enrollments
      WHERE id = ${enrollmentId}::uuid
    `)
    expect(captured.rows).toEqual([
      {
        snapshot_revision_count: '0',
        snapshot_revision_set_digest: EMPTY_REVIEW_ANALYSIS_REVISION_SET_DIGEST,
        enrolled_revision_count: '0',
      },
    ])
    const members = await db.execute(sql`
      SELECT count(*)::integer AS count
      FROM ai_review_analysis_enrollment_memberships
      WHERE enrollment_id = ${enrollmentId}::uuid
    `)
    expect(members.rows).toEqual([{ count: 0 }])

    const caughtUp = await adapter.reconcile({
      enrollmentId,
      organizationId: ORGANIZATION_ID,
      expectedFence: fence(0),
      correlationId: CORRELATION_ID,
      occurredAt: new Date(),
    })
    expect(caughtUp).toEqual({
      status: 'caught_up',
      eligibleRevisionCount: 0,
      caughtUpAnalysisSequence: 0,
      revisionSetDigest: EMPTY_REVIEW_ANALYSIS_REVISION_SET_DIGEST,
    })
    await expect(adapter.readCurrent(trigger(0))).resolves.toMatchObject({
      state: 'caught_up',
      snapshotRevisionCount: 0,
      caughtUpEligibleRevisionCount: 0,
      caughtUpAnalysisSequence: 0,
      caughtUpRevisionSetDigest: EMPTY_REVIEW_ANALYSIS_REVISION_SET_DIGEST,
      terminalReason: 'eligible_revision_set_caught_up',
    })
    await expect(adapter.applyAuthorizationLifecycle(trigger(0))).resolves.toEqual(
      expect.objectContaining({
        status: 'duplicate',
        enrollmentId,
      }),
    )

    await expect(
      db.execute(sql`
        UPDATE ai_review_analysis_enrollments
        SET snapshot_revision_set_digest = ${'f'.repeat(64)}
        WHERE id = ${enrollmentId}::uuid
      `),
    ).rejects.toMatchObject({
      cause: {
        code: '55000',
        message: 'Review Analysis enrollment authority is immutable',
      },
    })
    const immutable = await db.execute(sql`
      SELECT snapshot_revision_set_digest
      FROM ai_review_analysis_enrollments
      WHERE id = ${enrollmentId}::uuid
    `)
    expect(immutable.rows).toEqual([
      { snapshot_revision_set_digest: EMPTY_REVIEW_ANALYSIS_REVISION_SET_DIGEST },
    ])
  })

  it('contains a capability change, records its exact 24-hour local erasure objective, and rejects stale delivery', async () => {
    await seed(0)
    const adapter = createReviewAnalysisEnrollmentAdapter(db, randomUUID)
    const enabled = await adapter.applyAuthorizationLifecycle(trigger(0))
    expect(enabled).toMatchObject({
      status: 'applied',
      lifecycle: {
        authorizationState: 'enabled',
        transitionKind: 'enable',
        visibleDataClasses: ['review_analysis', 'property_aggregate'],
        retiredDataClasses: [],
        erasureStatus: 'not_required',
        erasureDeadlineEpochMillis: null,
      },
      enrollment: { status: 'queued' },
    })

    const changedAt = new Date('2026-08-27T09:00:00.000Z')
    const changedTrigger = await applyIdentityTransition({
      eventId: CHANGE_EVENT_ID,
      lineageId: LINEAGE_ID,
      expectedStateVersion: 1,
      stateVersion: 2,
      transitionKind: 'change',
      state: 'enabled',
      capabilities: ['reply_drafting'],
      reviewAnalysisEpoch: 2,
      replyDraftingEpoch: 2,
      propertyTrendsEpoch: 1,
      occurredAt: changedAt,
    })
    const changed = await adapter.applyAuthorizationLifecycle(changedTrigger)
    expect(changed).toMatchObject({
      status: 'applied',
      lifecycle: {
        authorizationState: 'enabled',
        transitionKind: 'change',
        authorizedCapabilities: ['reply_drafting'],
        visibleDataClasses: [],
        retiredDataClasses: ['review_analysis', 'property_aggregate'],
        erasureStatus: 'pending',
        erasureDeadlineEpochMillis: changedAt.getTime() + 24 * 60 * 60 * 1_000,
      },
      enrollment: {
        status: 'not_applicable',
        reason: 'review_analysis_not_authorized',
      },
    })
    const changedLifecycleId = changed.status === 'applied' ? changed.lifecycle.id : ''
    await expect(
      adapter.readCurrentLifecycle({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
      }),
    ).resolves.toMatchObject({ id: changedLifecycleId })
    await expect(adapter.readCurrent(trigger(0))).resolves.toMatchObject({
      state: 'superseded',
      terminalReason: 'review_analysis_not_authorized',
    })

    const stale = { ...trigger(0), eventEnvelopeId: STALE_EVENT_ID }
    await db.execute(sql`
      INSERT INTO outbox_events (
        id, event_type, event_version, payload, organization_id, property_id,
        source_context, source_aggregate_id, created_at
      ) VALUES (
        ${STALE_EVENT_ID}::uuid, 'identity.merchant_ai.changed', 1,
        '{}'::jsonb, ${ORGANIZATION_ID}, ${PROPERTY_ID}, 'identity',
        ${PROPERTY_ID}, ${changedAt}
      )
    `)
    await expect(adapter.applyAuthorizationLifecycle(stale)).resolves.toEqual({
      status: 'obsolete',
      reason: 'authorization_state_version_changed',
    })
    await expect(adapter.applyAuthorizationLifecycle(changedTrigger)).resolves.toEqual({
      status: 'duplicate',
      lifecycleId: changedLifecycleId,
      enrollmentId: null,
    })
  })

  it('contains every local derivative on revoke and records restore-reset as a separate disabled generation', async () => {
    await seed(0)
    const adapter = createReviewAnalysisEnrollmentAdapter(db, randomUUID)
    await adapter.applyAuthorizationLifecycle(trigger(0))

    const allEnabledAt = new Date('2026-08-27T09:00:00.000Z')
    const allEnabled = await applyIdentityTransition({
      eventId: CHANGE_EVENT_ID,
      lineageId: LINEAGE_ID,
      expectedStateVersion: 1,
      stateVersion: 2,
      transitionKind: 'change',
      state: 'enabled',
      capabilities: ['review_analysis', 'reply_drafting', 'property_trends'],
      reviewAnalysisEpoch: 1,
      replyDraftingEpoch: 2,
      propertyTrendsEpoch: 2,
      occurredAt: allEnabledAt,
    })
    await expect(adapter.applyAuthorizationLifecycle(allEnabled)).resolves.toMatchObject({
      status: 'applied',
      lifecycle: {
        visibleDataClasses: ['review_analysis', 'property_aggregate', 'property_trend'],
        retiredDataClasses: [],
      },
    })

    const revokedAt = new Date('2026-08-27T10:00:00.000Z')
    const revokedTrigger = await applyIdentityTransition({
      eventId: REVOKE_EVENT_ID,
      lineageId: LINEAGE_ID,
      expectedStateVersion: 2,
      stateVersion: 3,
      transitionKind: 'revoke',
      state: 'revoked',
      capabilities: [],
      reviewAnalysisEpoch: 2,
      replyDraftingEpoch: 3,
      propertyTrendsEpoch: 3,
      occurredAt: revokedAt,
    })
    await expect(
      adapter.applyAuthorizationLifecycle(revokedTrigger),
    ).resolves.toMatchObject({
      status: 'applied',
      lifecycle: {
        authorizationState: 'revoked',
        transitionKind: 'revoke',
        visibleDataClasses: [],
        retiredDataClasses: ['review_analysis', 'property_aggregate', 'property_trend'],
        erasureStatus: 'pending',
        erasureDeadlineEpochMillis: revokedAt.getTime() + 24 * 60 * 60 * 1_000,
      },
      enrollment: {
        status: 'not_applicable',
        reason: 'authorization_not_enabled',
      },
    })

    const restoreAt = new Date('2026-08-27T11:00:00.000Z')
    const disabledTrigger = await applyIdentityTransition({
      eventId: RESTORE_EVENT_ID,
      lineageId: RESTORE_LINEAGE_ID,
      expectedStateVersion: 3,
      stateVersion: 1,
      transitionKind: 'restore_reset',
      state: 'disabled',
      capabilities: [],
      reviewAnalysisEpoch: 1,
      replyDraftingEpoch: 1,
      propertyTrendsEpoch: 1,
      occurredAt: restoreAt,
    })
    await expect(
      adapter.applyAuthorizationLifecycle(disabledTrigger),
    ).resolves.toMatchObject({
      status: 'applied',
      lifecycle: {
        authorizationState: 'disabled',
        transitionKind: 'restore_reset',
        visibleDataClasses: [],
        retiredDataClasses: [],
        erasureStatus: 'not_required',
      },
      enrollment: {
        status: 'not_applicable',
        reason: 'authorization_not_enabled',
      },
    })
  })

  it('opens a tenant-scoped replay with the exact captured Material Review Revision', async () => {
    await seed(1)
    const adapter = createReviewAnalysisEnrollmentAdapter(db, randomUUID)
    const applied = await adapter.applyAuthorizationLifecycle(trigger(1))
    expect(applied).toMatchObject({
      status: 'applied',
      enrollment: { status: 'queued' },
    })
    const enrollmentId = appliedEnrollmentId(applied)

    const members = await db.execute(sql`
      SELECT review_id, source_epoch, source_revision, analysis_sequence
      FROM ai_review_analysis_enrollment_memberships
      WHERE enrollment_id = ${enrollmentId}::uuid
    `)
    expect(members.rows).toEqual([
      {
        review_id: REVIEW_ID,
        source_epoch: 0,
        source_revision: '1',
        analysis_sequence: '1',
      },
    ])

    const replay = await adapter.reconcile({
      enrollmentId,
      organizationId: ORGANIZATION_ID,
      expectedFence: fence(1),
      correlationId: CORRELATION_ID,
      occurredAt: new Date(),
    })
    expect(replay).toMatchObject({
      status: 'replay_started',
      pinnedRevisionCount: 1,
    })
    const runId = replay.status === 'replay_started' ? replay.runId : ''
    const pinned = await db.execute(sql`
      SELECT membership.review_id, membership.source_revision,
             replay.organization_id, replay.property_id
      FROM ai_review_analysis_backfill_run_memberships AS membership
      JOIN ai_review_analysis_enrollment_replays AS replay
        ON replay.run_id = membership.run_id
      WHERE membership.run_id = ${runId}::uuid
    `)
    expect(pinned.rows).toEqual([
      {
        review_id: REVIEW_ID,
        source_revision: '1',
        organization_id: ORGANIZATION_ID,
        property_id: PROPERTY_ID,
      },
    ])
  })

  it('preserves an over-ceiling snapshot whole and opens it only after exact assisted approval', async () => {
    const reviewCount = AI_REVIEW_ANALYSIS_ENROLLMENT_SAFETY_CEILING + 1
    await seed(reviewCount)
    const adapter = createReviewAnalysisEnrollmentAdapter(db, randomUUID)

    const applied = await adapter.applyAuthorizationLifecycle(trigger(reviewCount))
    expect(applied).toMatchObject({
      status: 'applied',
      enrollment: {
        status: 'awaiting_assisted_approval',
        eligibleRevisionCount: reviewCount,
        safetyCeiling: AI_REVIEW_ANALYSIS_ENROLLMENT_SAFETY_CEILING,
      },
    })
    const enrollmentId = appliedEnrollmentId(applied)

    const captured = await db.execute(sql`
      SELECT enrollment.snapshot_revision_count,
             enrollment.enrolled_revision_count,
             count(membership.review_id)::integer AS membership_count,
             max(membership.ordinal)::integer AS maximum_ordinal
      FROM ai_review_analysis_enrollments AS enrollment
      LEFT JOIN ai_review_analysis_enrollment_memberships AS membership
        ON membership.enrollment_id = enrollment.id
      WHERE enrollment.id = ${enrollmentId}::uuid
      GROUP BY enrollment.id
    `)
    expect(captured.rows).toEqual([
      {
        snapshot_revision_count: String(reviewCount),
        enrolled_revision_count: '0',
        membership_count: reviewCount,
        maximum_ordinal: reviewCount - 1,
      },
    ])
    await expect(adapter.listActionable(10)).resolves.toEqual([])
    await expect(
      adapter.reconcile({
        enrollmentId,
        organizationId: ORGANIZATION_ID,
        expectedFence: fence(reviewCount),
        correlationId: CORRELATION_ID,
        occurredAt: new Date(),
      }),
    ).resolves.toEqual({
      status: 'awaiting_assisted_approval',
      eligibleRevisionCount: reviewCount,
      safetyCeiling: AI_REVIEW_ANALYSIS_ENROLLMENT_SAFETY_CEILING,
    })

    const beforeApproval = await adapter.readCurrent(trigger(reviewCount))
    expect(beforeApproval).toMatchObject({
      id: enrollmentId,
      state: 'awaiting_assisted_approval',
      snapshotRevisionCount: reviewCount,
      safetyCeiling: AI_REVIEW_ANALYSIS_ENROLLMENT_SAFETY_CEILING,
      assistedApprovalRequired: true,
      assistedApproval: null,
    })
    if (!beforeApproval) throw new Error('over-ceiling enrollment is absent')
    await expect(
      db.execute(sql`
        UPDATE ai_review_analysis_enrollments
        SET state = 'queued', updated_at = transaction_timestamp()
        WHERE id = ${enrollmentId}::uuid
      `),
    ).rejects.toMatchObject({
      cause: {
        code: '55000',
        message: 'Review Analysis enrollment transition is invalid',
      },
    })
    await expect(
      adapter.approveAssistedReplay({
        enrollmentId,
        organizationId: ORGANIZATION_ID,
        expectedFence: fence(reviewCount),
        approvedByOperatorId: 'ai-beta-operator',
        approvalEvidenceDigest: 'd'.repeat(64),
        correlationId: '31000000-0000-4000-8000-000000000014',
        occurredAt: new Date(beforeApproval.snapshotCapturedAtEpochMillis - 1),
      }),
    ).resolves.toEqual({ status: 'refused', reason: 'approval_time_invalid' })
    const approvedAt = new Date(beforeApproval.snapshotCapturedAtEpochMillis + 1)
    const approval = {
      enrollmentId,
      organizationId: ORGANIZATION_ID,
      expectedFence: fence(reviewCount),
      approvedByOperatorId: 'ai-beta-operator',
      approvalEvidenceDigest: 'd'.repeat(64),
      correlationId: '31000000-0000-4000-8000-000000000014',
      occurredAt: approvedAt,
    } as const
    await expect(adapter.approveAssistedReplay(approval)).resolves.toEqual({
      status: 'approved',
      enrollmentId,
    })
    await expect(adapter.readCurrent(trigger(reviewCount))).resolves.toMatchObject({
      state: 'queued',
      snapshotRevisionCount: reviewCount,
      assistedApprovalRequired: true,
      assistedApproval: {
        approvedAtEpochMillis: approvedAt.getTime(),
        approvedByOperatorId: 'ai-beta-operator',
        approvalEvidenceDigest: 'd'.repeat(64),
        correlationId: approval.correlationId,
      },
    })
    await expect(adapter.listActionable(10)).resolves.toEqual([
      expect.objectContaining({ id: enrollmentId, state: 'queued' }),
    ])
    await expect(
      adapter.approveAssistedReplay({
        ...approval,
        correlationId: '31000000-0000-4000-8000-000000000015',
        occurredAt: new Date(approvedAt.getTime() + 1),
      }),
    ).resolves.toEqual({ status: 'duplicate', enrollmentId })
    await expect(
      adapter.approveAssistedReplay({
        ...approval,
        approvalEvidenceDigest: 'e'.repeat(64),
      }),
    ).resolves.toEqual({ status: 'refused', reason: 'approval_conflict' })
    await expect(
      db.execute(sql`
        UPDATE ai_review_analysis_enrollments
        SET assisted_approval_evidence_digest = ${'e'.repeat(64)}
        WHERE id = ${enrollmentId}::uuid
      `),
    ).rejects.toMatchObject({
      cause: {
        code: '55000',
        message: 'Review Analysis enrollment approval evidence is immutable',
      },
    })
  })

  it('does not replay an exact snapshot revision again after it is qualified', async () => {
    await seed(1)
    const adapter = createReviewAnalysisEnrollmentAdapter(db, randomUUID)
    const applied = await adapter.applyAuthorizationLifecycle(trigger(1))
    const enrollmentId = appliedEnrollmentId(applied)
    const replay = await adapter.reconcile({
      enrollmentId,
      organizationId: ORGANIZATION_ID,
      expectedFence: fence(1),
      correlationId: CORRELATION_ID,
      occurredAt: new Date(),
    })
    const runId = replay.status === 'replay_started' ? replay.runId : ''

    await db.execute(sql`
      UPDATE ai_review_analysis_backfill_runs
      SET state = 'completed', terminal_reason = 'run_exhausted',
          terminal_at = transaction_timestamp(), updated_at = transaction_timestamp()
      WHERE id = ${runId}::uuid
    `)
    await db.execute(sql`
      INSERT INTO outbox_events (
        id, event_type, event_version, payload, organization_id, property_id,
        source_context, source_aggregate_id, created_at
      ) VALUES (
        ${QUALIFIED_EVENT_ID}::uuid, 'review.created', 1,
        jsonb_build_object(
          'reviewId', ${REVIEW_ID}::text, 'sourceEpoch', 0,
          'sourceRevision', 1, 'analysisSequence', 1
        ),
        ${ORGANIZATION_ID}, ${PROPERTY_ID}, 'review', ${REVIEW_ID},
        transaction_timestamp()
      )
    `)
    await db.execute(sql`
      INSERT INTO ai_review_event_cursors (
        organization_id, property_id, source_epoch, review_analysis_epoch,
        analysis_start_sequence, consumed_sequence, terminal_analysis_sequence,
        aggregate_revision, last_consumed_event_id, created_at, updated_at
      ) VALUES (
        ${ORGANIZATION_ID}, ${PROPERTY_ID}::uuid, 0, 1, 1, 1, 1, 1,
        ${QUALIFIED_EVENT_ID}::uuid, transaction_timestamp(), transaction_timestamp()
      )
    `)
    await db.execute(sql`
      INSERT INTO ai_review_analysis_outcomes (
        organization_id, property_id, source_epoch, review_analysis_epoch,
        analysis_sequence, event_envelope_id, state, disposition_code,
        applied_aggregate_revision, applied_at, created_at, updated_at
      ) VALUES (
        ${ORGANIZATION_ID}, ${PROPERTY_ID}::uuid, 0, 1, 1,
        ${QUALIFIED_EVENT_ID}::uuid, 'terminal_no_result',
        'language_not_supported', 1, transaction_timestamp(),
        transaction_timestamp(), transaction_timestamp()
      )
    `)

    await expect(
      adapter.reconcile({
        enrollmentId,
        organizationId: ORGANIZATION_ID,
        expectedFence: fence(1),
        correlationId: CORRELATION_ID,
        occurredAt: new Date(),
      }),
    ).resolves.toMatchObject({
      status: 'caught_up',
      eligibleRevisionCount: 1,
      caughtUpAnalysisSequence: 1,
    })
    const runs = await db.execute(sql`
      SELECT count(*)::integer AS count
      FROM ai_review_analysis_enrollment_replays
      WHERE enrollment_id = ${enrollmentId}::uuid
    `)
    expect(runs.rows).toEqual([{ count: 1 }])
  })

  it('stalls an eligible snapshot revision after its bounded replay terminal-fails', async () => {
    await seed(1)
    const adapter = createReviewAnalysisEnrollmentAdapter(db, randomUUID)
    const applied = await adapter.applyAuthorizationLifecycle(trigger(1))
    const enrollmentId = appliedEnrollmentId(applied)
    const replay = await adapter.reconcile({
      enrollmentId,
      organizationId: ORGANIZATION_ID,
      expectedFence: fence(1),
      correlationId: CORRELATION_ID,
      occurredAt: new Date(),
    })
    const runId = replay.status === 'replay_started' ? replay.runId : ''

    await db.execute(sql`
      UPDATE ai_review_analysis_backfill_runs
      SET state = 'completed', terminal_reason = 'run_exhausted',
          terminal_at = transaction_timestamp(), updated_at = transaction_timestamp()
      WHERE id = ${runId}::uuid
    `)
    await db.execute(sql`
      INSERT INTO outbox_events (
        id, event_type, event_version, payload, organization_id, property_id,
        source_context, source_aggregate_id, created_at
      ) VALUES (
        ${QUALIFIED_EVENT_ID}::uuid, 'review.created', 1,
        jsonb_build_object(
          'reviewId', ${REVIEW_ID}::text, 'sourceEpoch', 0,
          'sourceRevision', 1, 'analysisSequence', 1
        ),
        ${ORGANIZATION_ID}, ${PROPERTY_ID}, 'review', ${REVIEW_ID},
        transaction_timestamp()
      )
    `)
    await db.execute(sql`
      INSERT INTO ai_review_event_cursors (
        organization_id, property_id, source_epoch, review_analysis_epoch,
        analysis_start_sequence, consumed_sequence, terminal_analysis_sequence,
        aggregate_revision, last_consumed_event_id, created_at, updated_at
      ) VALUES (
        ${ORGANIZATION_ID}, ${PROPERTY_ID}::uuid, 0, 1, 1, 1, 1, 1,
        ${QUALIFIED_EVENT_ID}::uuid, transaction_timestamp(), transaction_timestamp()
      )
    `)
    await db.execute(sql`
      INSERT INTO ai_review_analysis_outcomes (
        organization_id, property_id, source_epoch, review_analysis_epoch,
        analysis_sequence, event_envelope_id, state, disposition_code,
        applied_aggregate_revision, applied_at, created_at, updated_at
      ) VALUES (
        ${ORGANIZATION_ID}, ${PROPERTY_ID}::uuid, 0, 1, 1,
        ${QUALIFIED_EVENT_ID}::uuid, 'terminal_no_result',
        'policy_disabled', 1, transaction_timestamp(),
        transaction_timestamp(), transaction_timestamp()
      )
    `)

    await expect(
      adapter.reconcile({
        enrollmentId,
        organizationId: ORGANIZATION_ID,
        expectedFence: fence(1),
        correlationId: CORRELATION_ID,
        occurredAt: new Date(),
      }),
    ).resolves.toEqual({
      status: 'stalled',
      reason: 'verification_inconsistent',
    })
    await expect(adapter.readCurrent(trigger(1))).resolves.toMatchObject({
      state: 'stalled',
      terminalReason: 'eligible_revision_terminal_without_analysis',
    })
    const runs = await db.execute(sql`
      SELECT count(*)::integer AS count
      FROM ai_review_analysis_enrollment_replays
      WHERE enrollment_id = ${enrollmentId}::uuid
    `)
    expect(runs.rows).toEqual([{ count: 1 }])
  })

  it('claims exclusively, recovers an expired lease, and preserves safe failure evidence', async () => {
    const { revokedAt } = await createAllClassRetirement()
    const store = createAiAuthorizationErasureAdapter(db)
    const first = await store.claimNext({
      leaseOwner: ERASURE_LEASE_OWNER_A,
      now: revokedAt,
    })
    expect(first).toMatchObject({
      leaseOwner: ERASURE_LEASE_OWNER_A,
      attempt: 1,
    })
    await expect(
      store.claimNext({
        leaseOwner: ERASURE_LEASE_OWNER_B,
        now: new Date(revokedAt.getTime() + AI_AUTHORIZATION_ERASURE_LEASE_MILLIS - 1),
      }),
    ).resolves.toBeNull()
    const recoveredAt = new Date(
      revokedAt.getTime() + AI_AUTHORIZATION_ERASURE_LEASE_MILLIS,
    )
    await expect(
      store.claimNext({ leaseOwner: ERASURE_LEASE_OWNER_B, now: recoveredAt }),
    ).resolves.toMatchObject({
      leaseOwner: ERASURE_LEASE_OWNER_B,
      attempt: 2,
    })
  })

  it('physically erases the exact three retired local classes and records completion counts', async () => {
    const { lifecycleId, revokedAt } = await createAllClassRetirement()
    await seedRetiredDerivatives()
    const store = createAiAuthorizationErasureAdapter(db)
    const claim = await store.claimNext({
      leaseOwner: ERASURE_LEASE_OWNER_A,
      now: revokedAt,
    })
    if (!claim) throw new Error('AI erasure claim is absent')

    await expect(store.eraseClaim({ claim, now: revokedAt })).resolves.toEqual({
      status: 'completed',
      deleted: {
        reviewAnalysis: 1,
        propertyAggregate: 3,
        propertyTrend: 2,
      },
    })
    const evidence = await db.execute(sql`
      SELECT erasure_status, erasure_attempt_count, erasure_completed_at,
             erased_review_analysis_count, erased_property_aggregate_count,
             erased_property_trend_count
      FROM ai_authorization_lifecycle_records
      WHERE id = ${lifecycleId}::uuid
    `)
    expect(evidence.rows).toEqual([
      expect.objectContaining({
        erasure_status: 'completed',
        erasure_attempt_count: 1,
        erased_review_analysis_count: '1',
        erased_property_aggregate_count: '3',
        erased_property_trend_count: '2',
      }),
    ])
    const remaining = await db.execute(sql`
      SELECT
        (SELECT count(*)::integer FROM ai_review_analyses
          WHERE property_id = ${PROPERTY_ID}::uuid) AS analyses,
        (SELECT count(*)::integer FROM ai_property_aggregate_contributions
          WHERE property_id = ${PROPERTY_ID}::uuid) AS contributions,
        (SELECT count(*)::integer FROM ai_property_aggregate_heads
          WHERE property_id = ${PROPERTY_ID}::uuid) AS aggregate_heads,
        (SELECT count(*)::integer FROM ai_property_daily_aggregates
          WHERE property_id = ${PROPERTY_ID}::uuid) AS daily_aggregates,
        (SELECT count(*)::integer FROM ai_property_trend_schedules
          WHERE property_id = ${PROPERTY_ID}::uuid) AS trend_schedules,
        (SELECT count(*)::integer FROM ai_property_trend_outcomes
          WHERE property_id = ${PROPERTY_ID}::uuid) AS trend_outcomes
    `)
    expect(remaining.rows).toEqual([
      {
        analyses: 0,
        contributions: 0,
        aggregate_heads: 0,
        daily_aggregates: 0,
        trend_schedules: 0,
        trend_outcomes: 0,
      },
    ])
  })

  it('database-anchors every analysis to its exact Material Review Revision', async () => {
    await createAllClassRetirement()
    await seedRetiredDerivatives()
    await db.execute(sql`
      DELETE FROM ai_property_aggregate_contributions
      WHERE organization_id = ${ORGANIZATION_ID}
        AND property_id = ${PROPERTY_ID}::uuid
        AND review_id = ${REVIEW_ID}::uuid
    `)

    await expect(
      db.execute(sql`
        UPDATE ai_review_analyses
        SET source_revision = 2
        WHERE organization_id = ${ORGANIZATION_ID}
          AND property_id = ${PROPERTY_ID}::uuid
          AND review_id = ${REVIEW_ID}::uuid
      `),
    ).rejects.toMatchObject({
      cause: {
        code: '23503',
        constraint: 'ai_review_analyses_material_review_revision_fk',
      },
    })
    const analyses = await db.execute(sql`
      SELECT source_revision
      FROM ai_review_analyses
      WHERE organization_id = ${ORGANIZATION_ID}
        AND property_id = ${PROPERTY_ID}::uuid
        AND review_id = ${REVIEW_ID}::uuid
    `)
    expect(analyses.rows).toEqual([{ source_revision: '1' }])
  })

  it('terminal-settles the durable retry budget without exposing a raw failure', async () => {
    const { revokedAt } = await createAllClassRetirement()
    const store = createAiAuthorizationErasureAdapter(db)
    let dueAt = revokedAt
    for (let attempt = 1; attempt <= AI_AUTHORIZATION_ERASURE_MAX_ATTEMPTS; attempt++) {
      const claim = await store.claimNext({
        leaseOwner: ERASURE_LEASE_OWNER_A,
        now: dueAt,
      })
      expect(claim?.attempt).toBe(attempt)
      if (!claim) throw new Error('AI erasure claim is absent')
      const nextAttemptAt =
        attempt === AI_AUTHORIZATION_ERASURE_MAX_ATTEMPTS
          ? null
          : new Date(dueAt.getTime() + 30_000)
      await expect(
        store.recordClaimFailure({
          claim,
          failureCode: 'local_delete_failed',
          occurredAt: dueAt,
          nextAttemptAt,
        }),
      ).resolves.toEqual({
        status:
          attempt === AI_AUTHORIZATION_ERASURE_MAX_ATTEMPTS
            ? 'terminal_failed'
            : 'retry_scheduled',
      })
      if (nextAttemptAt) dueAt = nextAttemptAt
    }
    await expect(store.readBacklog(dueAt)).resolves.toMatchObject({
      terminalFailed: 1,
    })
    const evidence = await db.execute(sql`
      SELECT erasure_status, erasure_failure_code, erasure_attempt_count,
             erasure_next_attempt_at, erasure_lease_owner
      FROM ai_authorization_lifecycle_records
      WHERE organization_id = ${ORGANIZATION_ID}
        AND erasure_status = 'failed'
    `)
    expect(evidence.rows).toEqual([
      expect.objectContaining({
        erasure_failure_code: 'local_delete_failed',
        erasure_attempt_count: AI_AUTHORIZATION_ERASURE_MAX_ATTEMPTS,
        erasure_next_attempt_at: null,
        erasure_lease_owner: null,
      }),
    ])
  })

  it('fails closed instead of deleting a generation that current Identity authority could serve', async () => {
    const { lifecycleId } = await createAllClassRetirement()
    const reenabledAt = new Date('2026-08-27T11:00:00.000Z')
    await applyIdentityTransition({
      eventId: REENABLE_EVENT_ID,
      lineageId: LINEAGE_ID,
      expectedStateVersion: 3,
      stateVersion: 4,
      transitionKind: 'enable',
      state: 'enabled',
      capabilities: ['review_analysis', 'reply_drafting', 'property_trends'],
      reviewAnalysisEpoch: 3,
      replyDraftingEpoch: 4,
      propertyTrendsEpoch: 4,
      analysisStartSequence: 1,
      occurredAt: reenabledAt,
    })
    // Model a malformed/reused retired fence. The worker must independently
    // compare it with current Identity authority; lifecycle classification is
    // not permission to delete a generation that has become current.
    await db.execute(sql`
      UPDATE ai_authorization_lifecycle_records
      SET previous_review_analysis_epoch = 3,
          previous_property_trends_epoch = 4
      WHERE id = ${lifecycleId}::uuid
    `)
    const store = createAiAuthorizationErasureAdapter(db)
    const claim = await store.claimNext({
      leaseOwner: ERASURE_LEASE_OWNER_A,
      now: reenabledAt,
    })
    if (!claim) throw new Error('AI erasure claim is absent')

    await expect(store.eraseClaim({ claim, now: reenabledAt })).resolves.toEqual({
      status: 'terminal_failed',
    })
    const evidence = await db.execute(sql`
      SELECT erasure_status, erasure_failure_code
      FROM ai_authorization_lifecycle_records
      WHERE id = ${lifecycleId}::uuid
    `)
    expect(evidence.rows).toEqual([
      {
        erasure_status: 'failed',
        erasure_failure_code: 'active_generation_conflict',
      },
    ])
  })
})
