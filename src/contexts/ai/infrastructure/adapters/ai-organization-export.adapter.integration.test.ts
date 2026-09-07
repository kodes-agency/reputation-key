import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import {
  buildOrganizationExportBundle,
  CLASSIFICATIONS_BY_CONTEXT,
} from '#/contexts/identity/application/organization-export-contract'
import type { OrganizationLifecycleContext } from '#/contexts/identity/application/ports/organization-export-contributor.port'
import { createAiOrganizationExportContributor } from './ai-organization-export.adapter'

const ALL_CONTEXTS = Object.keys(
  CLASSIFICATIONS_BY_CONTEXT,
) as readonly OrganizationLifecycleContext[]

/** Values that must never appear in the derivative-only export. */
const MARKERS = Object.freeze({
  operationIdempotencyKey: 'NEVER_EXPORT_OPERATION_IDEMPOTENCY',
  reviewText: 'NEVER_EXPORT_GUEST_REVIEW_TEXT',
  reviewerName: 'NEVER_EXPORT_REVIEWER_NAME',
  reviewExternalId: 'NEVER_EXPORT_GOOGLE_REVIEW_ID',
})

const RETIRED_LINEAGE_ID = '5b6b5f2e-0000-4000-8000-00000000fee1'

type Fixture = Readonly<{
  organizationId: string
  userId: string
  memberId: string
  propertyId: string
  connectionId: string
  lineageId: string
  currentReviewId: string
  retiredReviewId: string
  expiredReviewId: string
  currentOperationId: string
  retiredOperationId: string
  expiredOperationId: string
  currentScheduleId: string
  retiredScheduleId: string
}>

const fixtures: Fixture[] = []
const emptyOrganizations = new Set<string>()
let lease: TestLease
let db: Database

const ANALYZED_AT = '2026-08-27T09:30:00.000Z'
const LOCAL_DATE = '2026-08-27'

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

async function seedOperation(
  fixture: Fixture,
  operationId: string,
  reviewId: string,
  analysisSequence: number,
  idempotencyKey: string,
): Promise<void> {
  const heads = await controlHeads()
  const global = heads.global!
  const provider = heads['provider:private-beta-global-v1']!
  const capability = heads['capability:review_analysis']!
  await lease.pool.query(
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
       $12, 1, 'private-beta-global-v1', 'review-analysis-v1',
       'review-analysis-runtime-v1', $13, $14, $15, $16, $17, $18,
       '{"capability":"review_analysis","reviewAnalysisEpoch":"1"}'::jsonb,
       'succeeded', 1, $19, $19, $20
     )`,
    [
      operationId,
      idempotencyKey,
      '1'.repeat(64),
      '2'.repeat(64),
      fixture.organizationId,
      fixture.propertyId,
      reviewId,
      randomUUID(),
      '3'.repeat(64),
      new Date(ANALYZED_AT).getTime(),
      analysisSequence,
      fixture.lineageId,
      global.controlId,
      global.generation,
      provider.controlId,
      provider.generation,
      capability.controlId,
      capability.generation,
      new Date(ANALYZED_AT),
      new Date(new Date(ANALYZED_AT).getTime() + 60_000),
    ],
  )
}

async function seedReview(
  fixture: Fixture,
  reviewId: string,
  analysisSequence: number,
): Promise<void> {
  await lease.pool.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id, reviewer_name,
       rating, text, language_code, reviewed_at, content_expires_at,
       source_epoch, source_revision, analysis_sequence, ai_source_byte_length,
       ai_source_digest
     ) VALUES ($1, $2, $3, 'google', $4, $5, 5, $6, 'en', $7, $8, 0, 1, $9, 20, $10)`,
    [
      reviewId,
      fixture.organizationId,
      fixture.propertyId,
      `${MARKERS.reviewExternalId}-${analysisSequence}`,
      MARKERS.reviewerName,
      MARKERS.reviewText,
      new Date('2026-08-20T10:00:00.000Z'),
      new Date('2027-08-20T10:00:00.000Z'),
      analysisSequence,
      'a'.repeat(64),
    ],
  )
  await lease.pool.query(
    `INSERT INTO material_review_revisions (
       review_id, revision, organization_id, property_id, source_epoch,
       normalization_version, source_digest, normalized_digest, rating,
       normalized_text, content_state
     ) VALUES ($1, 1, $2, $3, 0, 'legacy-unverified-v0', NULL, NULL, 5, $4, 'active')`,
    [reviewId, fixture.organizationId, fixture.propertyId, MARKERS.reviewText],
  )
}

async function seedAnalysis(
  fixture: Fixture,
  input: Readonly<{
    operationId: string
    reviewId: string
    analysisSequence: number
    lineageId: string
    reviewAnalysisEpoch: number
    expiresAt: Date
  }>,
): Promise<void> {
  await lease.pool.query(
    `INSERT INTO ai_review_analyses (
       organization_id, property_id, review_id, source_epoch, source_revision,
       analysis_sequence, operation_id, authorization_lineage_id,
       review_analysis_epoch, property_profile_version, analysis_profile_version,
       status, sentiment, primary_category, attention, generated_at, expires_at
     ) VALUES ($1, $2, $3, 0, 1, $4, $5, $6, $7, 1, 'review-analysis-v1', 'ready',
               'positive', 'service', 'low', $8, $9)`,
    [
      fixture.organizationId,
      fixture.propertyId,
      input.reviewId,
      input.analysisSequence,
      input.operationId,
      input.lineageId,
      input.reviewAnalysisEpoch,
      new Date(ANALYZED_AT),
      input.expiresAt,
    ],
  )
}

async function seedFixture(): Promise<Fixture> {
  const suffix = randomUUID()
  const fixture: Fixture = {
    organizationId: `ai-export-org-${suffix}`,
    userId: `ai-export-user-${suffix}`,
    memberId: `ai-export-member-${suffix}`,
    propertyId: randomUUID(),
    connectionId: randomUUID(),
    lineageId: randomUUID(),
    currentReviewId: randomUUID(),
    retiredReviewId: randomUUID(),
    expiredReviewId: randomUUID(),
    currentOperationId: randomUUID(),
    retiredOperationId: randomUUID(),
    expiredOperationId: randomUUID(),
    currentScheduleId: randomUUID(),
    retiredScheduleId: randomUUID(),
  }
  fixtures.push(fixture)

  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'AI Export Fixture', $1, now())`,
    [fixture.organizationId],
  )
  await lease.pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Export Manager', $2, true, now(), now())`,
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
       google_binding_state, profile_source, source_epoch
     ) VALUES ($1, $2, 'AI Export Property', $3, 'UTC', 'active', $4,
               'account-ai-export', 'location-ai-export', 'active', 'legacy', 0)`,
    [
      fixture.propertyId,
      fixture.organizationId,
      `ai-export-${suffix}`,
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
      `ai-export-enable-${suffix}`,
      'b'.repeat(64),
    ],
  )

  // One currently served derivative, one whose authorization generation was
  // retired, and one whose own retention window has lapsed.
  await seedReview(fixture, fixture.currentReviewId, 1)
  await seedReview(fixture, fixture.retiredReviewId, 2)
  await seedReview(fixture, fixture.expiredReviewId, 3)
  await seedOperation(
    fixture,
    fixture.currentOperationId,
    fixture.currentReviewId,
    1,
    `current-${suffix}`,
  )
  await seedOperation(
    fixture,
    fixture.retiredOperationId,
    fixture.retiredReviewId,
    2,
    `retired-${suffix}`,
  )
  await seedOperation(
    fixture,
    fixture.expiredOperationId,
    fixture.expiredReviewId,
    3,
    MARKERS.operationIdempotencyKey,
  )
  await seedAnalysis(fixture, {
    operationId: fixture.currentOperationId,
    reviewId: fixture.currentReviewId,
    analysisSequence: 1,
    lineageId: fixture.lineageId,
    reviewAnalysisEpoch: 1,
    expiresAt: new Date(Date.now() + 86_400_000),
  })
  await seedAnalysis(fixture, {
    operationId: fixture.retiredOperationId,
    reviewId: fixture.retiredReviewId,
    analysisSequence: 2,
    lineageId: RETIRED_LINEAGE_ID,
    reviewAnalysisEpoch: 1,
    expiresAt: new Date(Date.now() + 86_400_000),
  })
  await seedAnalysis(fixture, {
    operationId: fixture.expiredOperationId,
    reviewId: fixture.expiredReviewId,
    analysisSequence: 3,
    lineageId: fixture.lineageId,
    reviewAnalysisEpoch: 1,
    expiresAt: new Date(Date.now() - 60_000),
  })

  for (const [localDate, epoch] of [
    [LOCAL_DATE, 1],
    ['2026-08-26', 2],
  ] as const) {
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
       ) VALUES ($1, $2, $3, 0, $4, 1, 'property-calendar-v1', 1, 1, 1, 5, 1, 0,
                 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, $5)`,
      [
        fixture.organizationId,
        fixture.propertyId,
        localDate,
        epoch,
        new Date(ANALYZED_AT),
      ],
    )
  }

  for (const [scheduleId, trendsEpoch, dueDate] of [
    [fixture.currentScheduleId, 1, LOCAL_DATE],
    [fixture.retiredScheduleId, 2, '2026-08-26'],
  ] as const) {
    await lease.pool.query(
      `INSERT INTO ai_property_trend_schedules (
         id, outbox_event_id, organization_id, property_id, due_local_date,
         source_epoch, review_analysis_epoch, property_trends_epoch,
         property_profile_version, terminal_analysis_sequence,
         aggregate_revision, timezone, calendar_profile_version,
         report_profile_version, scheduler_generation, scheduled_at
       ) VALUES ($1, $2, $3, $4, $5, 0, 1, $6, 1, 1, 1, 'UTC',
                 'property-calendar-v1', 'property-trend-v1', 1, $7)`,
      [
        scheduleId,
        randomUUID(),
        fixture.organizationId,
        fixture.propertyId,
        dueDate,
        trendsEpoch,
        new Date(ANALYZED_AT),
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
                 'Review signals improved', '["Service improved."]'::jsonb,
                 'Service improved.', 'trend-render-v1', $4, $5, $6)`,
      [
        scheduleId,
        fixture.organizationId,
        fixture.propertyId,
        '4'.repeat(64),
        new Date(ANALYZED_AT),
        new Date(Date.now() + 86_400_000),
      ],
    )
  }

  return fixture
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
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
  await deleteTestOrganizations(lease.pool, [fixture.organizationId])
  await lease.pool.query('DELETE FROM "user" WHERE id = $1', [fixture.userId])
}

const archiveText = (entries: readonly { bytes: Uint8Array }[]) =>
  entries.map(({ bytes }) => Buffer.from(bytes).toString('utf8')).join('\n')

const jsonRecords = (
  entries: readonly { path: string; bytes: Uint8Array }[],
  path: string,
): readonly Record<string, unknown>[] =>
  (
    JSON.parse(
      Buffer.from(entries.find((entry) => entry.path === path)!.bytes).toString('utf8'),
    ) as { records: Record<string, unknown>[] }
  ).records

describe.sequential('AI Organization Export contributor', () => {
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
    await deleteTestOrganizations(lease.pool, [...emptyOrganizations])
    emptyOrganizations.clear()
  })

  it('exports only derivatives the current authorization fence still serves', async () => {
    const fixture = await seedFixture()
    const asOf = new Date(Date.now() - 1000)
    const contributor = createAiOrganizationExportContributor(db)

    const first = await contributor.contribute({
      organizationId: fixture.organizationId,
      requestId: randomUUID(),
      asOf,
    })
    const replay = await contributor.contribute({
      organizationId: fixture.organizationId,
      requestId: randomUUID(),
      asOf,
    })

    expect(first).toEqual(replay)
    expect(first).toMatchObject({
      context: 'ai',
      coverage: 'complete',
      omissionCodes: [],
    })
    expect(
      first.entries.map(({ path, classification }) => ({ path, classification })),
    ).toEqual([
      { path: 'ai/review-analyses.csv', classification: 'retained_ai_derivative' },
      { path: 'ai/review-analyses.json', classification: 'retained_ai_derivative' },
      {
        path: 'ai/property-daily-aggregates.csv',
        classification: 'retained_ai_derivative',
      },
      {
        path: 'ai/property-daily-aggregates.json',
        classification: 'retained_ai_derivative',
      },
      {
        path: 'ai/property-trend-outcomes.csv',
        classification: 'retained_ai_derivative',
      },
      {
        path: 'ai/property-trend-outcomes.json',
        classification: 'retained_ai_derivative',
      },
    ])

    // The retired-generation row and the retention-expired row are absent long
    // before the 24-hour physical erasure worker touches them.
    const analyses = jsonRecords(first.entries, 'ai/review-analyses.json')
    expect(analyses).toHaveLength(1)
    expect(analyses[0]).toMatchObject({
      review_id: fixture.currentReviewId,
      // `analysis_sequence` is a PostgreSQL bigint: exported as a lossless
      // string rather than a float that could silently round.
      analysis_sequence: '1',
      review_analysis_epoch: 1,
      authorization_lineage_id: fixture.lineageId,
      sentiment: 'positive',
      primary_category: 'service',
      attention: 'low',
      status: 'ready',
    })

    const aggregates = jsonRecords(first.entries, 'ai/property-daily-aggregates.json')
    expect(aggregates).toHaveLength(1)
    expect(aggregates[0]).toMatchObject({
      local_date: LOCAL_DATE,
      review_analysis_epoch: 1,
      review_count: 1,
      rating_sum: 5,
      positive_count: 1,
    })

    const trends = jsonRecords(first.entries, 'ai/property-trend-outcomes.json')
    expect(trends).toHaveLength(1)
    expect(trends[0]).toMatchObject({
      schedule_id: fixture.currentScheduleId,
      property_trends_epoch: 1,
      disposition: 'ready',
      signal_key: 'category.service',
      summary: 'Service improved.',
    })

    const archive = archiveText(first.entries)
    expect(archive).not.toContain(fixture.retiredReviewId)
    expect(archive).not.toContain(fixture.expiredReviewId)
    expect(archive).not.toContain(RETIRED_LINEAGE_ID)
    expect(archive).not.toContain(fixture.retiredScheduleId)
  })

  it('leaks no prompt, inference, admission or Google source material', async () => {
    const fixture = await seedFixture()

    const contribution = await createAiOrganizationExportContributor(db).contribute({
      organizationId: fixture.organizationId,
      requestId: randomUUID(),
      asOf: new Date(Date.now() - 1000),
    })
    const archive = archiveText(contribution.entries)

    for (const [name, marker] of Object.entries(MARKERS)) {
      expect(`${name}:${archive.includes(marker) ? 'leaked' : 'withheld'}`).toBe(
        `${name}:withheld`,
      )
    }
    expect(archive).not.toContain(fixture.currentOperationId)
    expect(archive).not.toMatch(
      /operation_id|subject_hmac|request_fingerprint|source_digest|maximum_cost_micros/u,
    )

    const payload = JSON.parse(
      Buffer.from(
        contribution.entries.find(({ path }) => path === 'ai/review-analyses.json')!
          .bytes,
      ).toString('utf8'),
    ) as { excludedRecordClasses: readonly { recordClass: string }[] }
    expect(payload.excludedRecordClasses.map(({ recordClass }) => recordClass)).toEqual(
      expect.arrayContaining([
        'ai_operations_and_attempts',
        'ai_admission_permits_quota_and_cost',
        'ai_provider_deployment_and_routing_profiles',
        'ai_governance_and_execution_controls',
        'ai_reply_draft_provider_output',
        'google_review_source_content',
      ]),
    )
  })

  it('answers no_data once the authorization is revoked, before erasure runs', async () => {
    const fixture = await seedFixture()
    await lease.pool.query(
      `SELECT (
         apply_merchant_ai_transition_v1(
           $1::uuid, 1, 2, $2, $3::uuid, 'revoke', 'revoked', ARRAY[]::text[],
           '{}'::jsonb, 2, 2, 2, 0, 0, $4, $5,
           'google-business-profile-source-policy-v1', 1, 'global',
           'private-beta-global-v1', 'gbp-review-global-v1', $6,
           'merchant_revoked', $7, $8, now()
         )
       ).*`,
      [
        fixture.lineageId,
        fixture.organizationId,
        fixture.propertyId,
        MERCHANT_AI_NOTICE_VERSION,
        MERCHANT_AI_NOTICE_DIGEST,
        fixture.userId,
        `ai-export-revoke-${fixture.propertyId}`,
        'c'.repeat(64),
      ],
    )

    const analysesStillPresent = await lease.pool.query(
      'SELECT count(*)::int AS count FROM ai_review_analyses WHERE organization_id = $1',
      [fixture.organizationId],
    )
    expect(analysesStillPresent.rows[0]).toMatchObject({ count: 3 })

    const contribution = await createAiOrganizationExportContributor(db).contribute({
      organizationId: fixture.organizationId,
      requestId: randomUUID(),
      asOf: new Date(Date.now() - 1000),
    })

    expect(contribution).toEqual({
      context: 'ai',
      coverage: 'no_data',
      omissionCodes: [],
      entries: [],
    })
  })

  it('answers no_data for an Organization that never authorized AI', async () => {
    const organizationId = `ai-export-empty-${randomUUID()}`
    emptyOrganizations.add(organizationId)
    await lease.pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, 'AI Export Empty', $1, now())`,
      [organizationId],
    )

    const contribution = await createAiOrganizationExportContributor(db).contribute({
      organizationId,
      requestId: randomUUID(),
      asOf: new Date(Date.now() - 1000),
    })

    expect(contribution).toEqual({
      context: 'ai',
      coverage: 'no_data',
      omissionCodes: [],
      entries: [],
    })
  })

  it('is accepted by the Organization Export bundle builder', async () => {
    const fixture = await seedFixture()
    const contributor = createAiOrganizationExportContributor(db)

    const bundle = await buildOrganizationExportBundle({
      organizationId: fixture.organizationId,
      requestId: randomUUID(),
      asOf: new Date(Date.now() - 1000),
      contributors: ALL_CONTEXTS.map((context) =>
        context === 'ai'
          ? contributor
          : {
              context,
              contribute: async () => ({
                context,
                coverage: 'no_data' as const,
                omissionCodes: [],
                entries: [],
              }),
            },
      ),
    })

    expect(bundle.entries.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        'ai/review-analyses.csv',
        'ai/review-analyses.json',
        'ai/property-daily-aggregates.csv',
        'ai/property-daily-aggregates.json',
        'ai/property-trend-outcomes.csv',
        'ai/property-trend-outcomes.json',
        'coverage.json',
        'manifest.json',
      ]),
    )
  })

  it('fails closed when a queued request is outside the bounded snapshot window', async () => {
    const fixture = await seedFixture()

    await expect(
      createAiOrganizationExportContributor(db).contribute({
        organizationId: fixture.organizationId,
        requestId: randomUUID(),
        asOf: new Date(Date.now() - 16 * 60 * 1000),
      }),
    ).rejects.toThrow(/snapshot window is unavailable/)
  })
})
