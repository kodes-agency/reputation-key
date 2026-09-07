// LIF-01 T12/T13/T14 — Review lifecycle contributor against real PostgreSQL.
//
// The unit test proves the decision logic. Only a real schema can prove what
// the program actually rests on:
//   * closing STOPS PROVIDER EFFECTS — sync/import scheduling is fenced and a
//     pre-dispatch reply publication is cancelled — while DELETING NOTHING;
//   * readiness is READ ONLY, and fails closed on an unsettled provider write;
//   * purge erases provider and manager content, keeps the immutable
//     publication authorization PostgreSQL refuses to let anyone delete, and
//     converges when it runs twice.

import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { getDb, type Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import type { OrganizationLifecycleContributionInput } from '#/contexts/identity/application/ports/organization-lifecycle-contributor.port'
import { createReviewOrganizationLifecycleContributor } from './review-organization-lifecycle.adapter'

const ORG_ID = 'org-review-lifecycle-00000000001'
const OTHER_ORG_ID = 'org-review-lifecycle-00000000002'
const PROPERTY_ID = '8c000000-0000-4000-8000-000000000001'
const OTHER_PROPERTY_ID = '8c000000-0000-4000-8000-000000000002'
const PUBLISHED_REVIEW_ID = '8c000000-0000-4000-8000-000000000003'
const PENDING_REVIEW_ID = '8c000000-0000-4000-8000-000000000004'
const OTHER_REVIEW_ID = '8c000000-0000-4000-8000-000000000005'
const PUBLISHED_REPLY_ID = '8c000000-0000-4000-8000-000000000006'
const PENDING_REPLY_ID = '8c000000-0000-4000-8000-000000000007'
const ATTEMPT_ID = '8c000000-0000-4000-8000-000000000008'
const OBSERVATION_ID = '8c000000-0000-4000-8000-000000000009'
const SNAPSHOT_RUN_ID = '8c000000-0000-4000-8000-00000000000a'
const MANAGER_ID = 'user-review-lifecycle-manager-01'
const AT = new Date('2026-08-26T10:00:00.000Z')
const EXPIRES_AT = new Date('2027-08-26T10:00:00.000Z')
const NEXT_SYNC_AT = new Date('2026-08-29T10:00:00.000Z')
const RECOVERABLE_UNTIL = new Date('2026-09-27T00:00:00.000Z')
const OCCURRED_AT = new Date('2026-08-28T12:00:00.000Z')
const DIGEST = 'd'.repeat(64)
const KEY = 'e'.repeat(64)

/** Guest text and manager text that must not survive the purge. */
const GUEST_TEXT = 'REVIEW_GUEST_TEXT_MUST_NOT_SURVIVE'
const GUEST_NAME = 'REVIEW_GUEST_NAME_MUST_NOT_SURVIVE'
const REPLY_TEXT = 'REVIEW_MANAGER_REPLY_MUST_NOT_SURVIVE'
const PROVIDER_MESSAGE_ID = 'REVIEW_PROVIDER_MESSAGE_MUST_NOT_SURVIVE'

/** Every Organization-scoped Review table, in child-before-parent order. */
const REVIEW_ORG_TABLES = Object.freeze([
  'google_reply_observation_heads',
  'google_reply_observations',
  'reply_publication_attempts',
  'reply_publication_authorizations',
  'replies',
  'review_source_observations',
  'review_source_contents',
  'review_ai_analysis_heads',
  'review_google_reputation_snapshot_facts',
  'review_provider_subjects',
  'review_provider_snapshot_runs',
  'material_review_revisions',
  'reviews',
] as const)

const db: Database = getDb()
let pool: Pool

const CLOSURE_PATH = Object.freeze([
  ['closure_requested', 'test_workspace'],
  ['closing', 'closing_prepared'],
  ['purge_pending', 'recovery_window_elapsed'],
  ['purging', 'irreversible_purge_authorized'],
] as const)

type ClosureState = (typeof CLOSURE_PATH)[number][0]

let closureLineageId: string
let closureStep: number

function contribution(): OrganizationLifecycleContributionInput {
  return {
    organizationId: ORG_ID,
    closureLineageId,
    lifecycleRevision: closureStep,
    recoverableUntil: RECOVERABLE_UNTIL,
    occurredAt: OCCURRED_AT,
  }
}

/**
 * The real closure path. PostgreSQL enforces the state machine, the reason
 * code on each edge, and a revision that advances by exactly one, so the
 * fixture cannot jump straight to a phase's required state.
 */
async function advanceAuthorityTo(
  target: ClosureState,
): Promise<OrganizationLifecycleContributionInput> {
  const targetStep = CLOSURE_PATH.findIndex(([state]) => state === target) + 1
  while (closureStep < targetStep) {
    const [state, reasonCode] = CLOSURE_PATH[closureStep]!
    if (closureStep === 0) {
      await pool.query(
        `UPDATE organization_lifecycle_authority
         SET state = $1, revision = revision + 1, closure_lineage_id = $2,
             closure_requested_at = $3, recoverable_until = $4,
             reactivation_required = true,
             requested_by = 'admin:review-lifecycle-test',
             request_reason_code = 'test_workspace',
             request_support_evidence_ref = 'test:review-lifecycle',
             last_transition_at = $3, last_actor_id = 'admin:review-lifecycle-test',
             last_reason_code = $5,
             last_support_evidence_ref = 'test:review-lifecycle'
         WHERE organization_id = $6`,
        [state, closureLineageId, AT, RECOVERABLE_UNTIL, reasonCode, ORG_ID],
      )
    } else {
      // Crossing into `purging` must stamp the irreversible boundary; the
      // state-shape CHECK constraint refuses the row without it.
      await pool.query(
        `UPDATE organization_lifecycle_authority
         SET state = $1, revision = revision + 1, last_reason_code = $2,
             last_transition_at = $3, last_actor_id = 'admin:review-lifecycle-test',
             last_support_evidence_ref = 'test:review-lifecycle',
             irreversible_at = CASE WHEN $1 = 'purging' THEN $3 ELSE irreversible_at END
         WHERE organization_id = $4`,
        [state, reasonCode, AT, ORG_ID],
      )
    }
    closureStep += 1
  }
  return contribution()
}

/**
 * Publication authorizations and lifecycle receipts are guarded by ALWAYS
 * triggers in production. Fixture teardown lifts both for the duration of a
 * delete; no runtime path does this, which is precisely why the adapter has to
 * scrub those rows instead of removing them.
 */
async function withGuardsDisabled(work: () => Promise<void>): Promise<void> {
  await pool.query(
    'ALTER TABLE reply_publication_authorizations DISABLE TRIGGER reply_publication_authorizations_immutable',
  )
  await pool.query(
    'ALTER TABLE context_organization_lifecycle_receipts DISABLE TRIGGER context_organization_lifecycle_receipts_update_delete_guard',
  )
  try {
    await work()
  } finally {
    await pool.query(
      'ALTER TABLE context_organization_lifecycle_receipts ENABLE ALWAYS TRIGGER context_organization_lifecycle_receipts_update_delete_guard',
    )
    await pool.query(
      'ALTER TABLE reply_publication_authorizations ENABLE ALWAYS TRIGGER reply_publication_authorizations_immutable',
    )
  }
}

async function clean(): Promise<void> {
  await withGuardsDisabled(async () => {
    for (const org of [ORG_ID, OTHER_ORG_ID]) {
      await pool.query(
        'DELETE FROM context_organization_lifecycle_receipts WHERE organization_id = $1',
        [org],
      )
      // Break the attempt <-> observation confirmation cycle before deleting
      // either side, exactly as the purge phase has to.
      await pool.query(
        `UPDATE reply_publication_attempts
         SET outcome = 'superseded', confirmed_observation_revision = NULL
         WHERE organization_id = $1 AND confirmed_observation_revision IS NOT NULL`,
        [org],
      )
      for (const table of REVIEW_ORG_TABLES) {
        await pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [org])
      }
      await pool.query(
        `DELETE FROM review_sync_state WHERE property_id IN
           (SELECT id::text FROM properties WHERE organization_id = $1)`,
        [org],
      )
      await pool.query(
        `DELETE FROM review_sync_runs WHERE property_id IN
           (SELECT id::text FROM properties WHERE organization_id = $1)`,
        [org],
      )
      await pool.query(
        `DELETE FROM idempotency_receipts WHERE scope = 'gbp_webhook'
           AND payload->>'resolvedPropertyId' IN
             (SELECT id::text FROM properties WHERE organization_id = $1)`,
        [org],
      )
      await pool.query('DELETE FROM properties WHERE organization_id = $1', [org])
    }
  })
  await deleteTestOrganizations(pool, [ORG_ID, OTHER_ORG_ID])
}

async function seedOrganizations(): Promise<void> {
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Review Lifecycle Test', 'review-lifecycle-0001', $2)`,
    [ORG_ID, AT],
  )
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Review Lifecycle Other', 'review-lifecycle-0002', $2)`,
    [OTHER_ORG_ID, AT],
  )
  for (const [propertyId, org, slug] of [
    [PROPERTY_ID, ORG_ID, 'review-lifecycle-property'],
    [OTHER_PROPERTY_ID, OTHER_ORG_ID, 'review-lifecycle-other-property'],
  ] as const) {
    await pool.query(
      `INSERT INTO properties (
         id, organization_id, name, slug, timezone, source_epoch, created_at, updated_at
       ) VALUES ($1, $2, 'Lifecycle Property', $3, 'UTC', 0, $4, $4)`,
      [propertyId, org, slug, AT],
    )
  }
}

async function insertReview(
  reviewId: string,
  org: string,
  propertyId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id,
       external_location_id, reviewer_name, rating, text, language_code,
       reviewed_at, expires_at, source_epoch, source_revision,
       source_observation_sequence, analysis_sequence, ai_source_byte_length,
       ai_source_digest, source_content_state, created_at, updated_at
     ) VALUES ($1, $2, $3, 'google', $4, 'locations/review-lifecycle', $5, 4, $6,
               'en', $7, $8, 0, 1, 1, 1, 24, $9, 'active', $7, $7)`,
    [
      reviewId,
      org,
      propertyId,
      `external-${reviewId}`,
      GUEST_NAME,
      GUEST_TEXT,
      AT,
      EXPIRES_AT,
      DIGEST,
    ],
  )
  await pool.query(
    `INSERT INTO material_review_revisions (
       review_id, revision, organization_id, property_id, source_epoch,
       normalization_version, source_digest, normalized_digest, rating,
       normalized_text, content_state, response_target_eligibility,
       response_target_start_at, created_at, updated_at
     ) VALUES ($1, 1, $2, $3, 0, 'review-material-v1', $4, $4, 4, $5, 'active',
               'measured', $6, $6, $6)`,
    [reviewId, org, propertyId, DIGEST, GUEST_TEXT, AT],
  )
}

/**
 * A fully worked Review tenant: provider content, a published Reply with its
 * immutable authorization/attempt/observation chain, a Reply still waiting to
 * be dispatched, an armed sync schedule, and a provider webhook receipt.
 */
async function seedReviewWork(): Promise<void> {
  await insertReview(PUBLISHED_REVIEW_ID, ORG_ID, PROPERTY_ID)
  await insertReview(PENDING_REVIEW_ID, ORG_ID, PROPERTY_ID)
  await insertReview(OTHER_REVIEW_ID, OTHER_ORG_ID, OTHER_PROPERTY_ID)

  await pool.query(
    `INSERT INTO review_source_contents (
       review_id, organization_id, property_id, platform, external_id,
       external_location_id, reviewer_name, rating, text, language_code,
       reviewed_at, last_fetched_at, content_expires_at, source_epoch,
       source_revision, ai_source_byte_length, ai_source_digest,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 'google', $4, 'locations/review-lifecycle', $5, 4, $6,
               'en', $7, $7, $8, 0, 1, 24, $9, $7, $7)`,
    [
      PUBLISHED_REVIEW_ID,
      ORG_ID,
      PROPERTY_ID,
      `external-${PUBLISHED_REVIEW_ID}`,
      GUEST_NAME,
      GUEST_TEXT,
      AT,
      EXPIRES_AT,
      DIGEST,
    ],
  )
  await pool.query(
    `INSERT INTO review_source_observations (
       review_id, observation_sequence, organization_id, property_id,
       source_epoch, observation_key, observation_digest, material_revision,
       observed_at, content_expires_at, source_digest, normalization_version,
       normalized_digest, comparison_result, rating, original_text,
       reviewer_name, reviewed_at, content_state, created_at, updated_at
     ) VALUES ($1, 1, $2, $3, 0, $4, $5, 1, $6, $7, $5, 'review-material-v1', $5,
               'initial_material_revision', 4, $8, $9, $6, 'active', $6, $6)`,
    [
      PUBLISHED_REVIEW_ID,
      ORG_ID,
      PROPERTY_ID,
      KEY,
      DIGEST,
      AT,
      EXPIRES_AT,
      GUEST_TEXT,
      GUEST_NAME,
    ],
  )

  // The published Reply and its immutable authorization chain.
  await pool.query(
    `INSERT INTO replies (
       id, review_id, organization_id, text, status, source, created_by,
       approved_by, authorship, publication_state, publication_cycle,
       published_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'published', 'internal', $5, $5, 'human',
               'published', 1, $6, $6, $6)`,
    [PUBLISHED_REPLY_ID, PUBLISHED_REVIEW_ID, ORG_ID, REPLY_TEXT, MANAGER_ID, AT],
  )
  // A Reply whose cycle is authorized but NOT yet dispatched to the provider.
  await pool.query(
    `INSERT INTO replies (
       id, review_id, organization_id, text, status, source, created_by,
       approved_by, authorship, publication_state, publication_cycle,
       created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'approved', 'internal', $5, $5, 'human',
               'authorized', 1, $6, $6)`,
    [PENDING_REPLY_ID, PENDING_REVIEW_ID, ORG_ID, REPLY_TEXT, MANAGER_ID, AT],
  )
  await pool.query(
    `INSERT INTO reply_publication_authorizations (
       organization_id, property_id, review_id, reply_id, publication_cycle,
       source_epoch, material_review_revision, base_observation_revision,
       authorized_by_user_id, reply_state_revision, normalization_version,
       expected_reply_digest, authorized_at, created_at
     ) VALUES ($1, $2, $3, $4, 1, 0, 1, 0, $5, 1, 'google-reply-v1', $6, $7, $7)`,
    [
      ORG_ID,
      PROPERTY_ID,
      PUBLISHED_REVIEW_ID,
      PUBLISHED_REPLY_ID,
      MANAGER_ID,
      DIGEST,
      AT,
    ],
  )
  // Insert the attempt unconfirmed first: the confirming observation does not
  // exist yet and both foreign keys are non-deferrable.
  await pool.query(
    `INSERT INTO reply_publication_attempts (
       id, organization_id, property_id, review_id, reply_id, publication_cycle,
       attempt_number, provider_operation_key, source_epoch,
       material_review_revision, reply_state_revision, base_observation_revision,
       normalization_version, expected_reply_digest, outcome,
       provider_correlation_id, provider_responded_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, 1, 1, $6, 0, 1, 1, 0, 'google-reply-v1', $7,
               'sending', $8, $9, $9, $9)`,
    [
      ATTEMPT_ID,
      ORG_ID,
      PROPERTY_ID,
      PUBLISHED_REVIEW_ID,
      PUBLISHED_REPLY_ID,
      `provider-op-${ATTEMPT_ID}`,
      DIGEST,
      `provider-correlation-${ATTEMPT_ID}`,
      AT,
    ],
  )
  await pool.query(
    `INSERT INTO google_reply_observations (
       id, organization_id, property_id, review_id, observation_revision,
       observation_key, input_digest, source_epoch, material_review_revision,
       read_generation, state, change, resolution, source, provenance,
       normalized_text, normalization_version, normalized_digest,
       matched_reply_id, matched_publication_cycle, matched_attempt_number,
       observed_at, content_expires_at, content_state, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 1, $5, $6, 0, 1, 1, 'live', 'added',
               'confirmed_on_google', 'targeted_reconciliation', 'repkey_confirmed',
               $7, 'google-reply-v1', $6, $8, 1, 1, $9, $10, 'active', $9, $9)`,
    [
      OBSERVATION_ID,
      ORG_ID,
      PROPERTY_ID,
      PUBLISHED_REVIEW_ID,
      KEY,
      DIGEST,
      REPLY_TEXT,
      PUBLISHED_REPLY_ID,
      AT,
      EXPIRES_AT,
    ],
  )
  await pool.query(
    `UPDATE reply_publication_attempts
     SET outcome = 'confirmed', confirmed_observation_revision = 1
     WHERE id = $1`,
    [ATTEMPT_ID],
  )
  await pool.query(
    `INSERT INTO google_reply_observation_heads (
       review_id, organization_id, property_id, observation_id,
       observation_revision, source_epoch, material_review_revision, state,
       provenance, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 1, 0, 1, 'live', 'repkey_confirmed', $5, $5)`,
    [PUBLISHED_REVIEW_ID, ORG_ID, PROPERTY_ID, OBSERVATION_ID, AT],
  )

  await pool.query(
    `INSERT INTO review_ai_analysis_heads (
       organization_id, property_id, source_epoch, head_sequence, created_at, updated_at
     ) VALUES ($1, $2, 0, 1, $3, $3)`,
    [ORG_ID, PROPERTY_ID, AT],
  )
  await pool.query(
    `INSERT INTO review_provider_snapshot_runs (
       id, organization_id, property_id, source_epoch, state, phase,
       expected_total, expected_average_rating, main_page_count,
       main_unique_count, confirmation_page_count, confirmation_unique_count,
       started_at, confirmation_deadline, expires_at, terminal_at,
       record_expires_at, observation_origin, created_at, updated_at
     ) VALUES ($1, $2, $3, 0, 'completed', 'terminal', 1, 4, 1, 1, 1, 1,
               $4::timestamptz, $5::timestamptz, $5::timestamptz, $4::timestamptz,
               $4::timestamptz + interval '30 days', 'ongoing',
               $4::timestamptz, $4::timestamptz)`,
    [SNAPSHOT_RUN_ID, ORG_ID, PROPERTY_ID, AT, EXPIRES_AT],
  )

  // Provider scheduling and provider notification identifiers.
  for (const [propertyId, nextAt] of [
    [PROPERTY_ID, NEXT_SYNC_AT],
    [OTHER_PROPERTY_ID, NEXT_SYNC_AT],
  ] as const) {
    await pool.query(
      `INSERT INTO review_sync_state (
         property_id, source, source_epoch, next_incremental_at,
         next_inventory_at, error_retry_at, updated_at
       ) VALUES ($1, 'google', 0, $2, $2, $2, $3)`,
      [propertyId, nextAt, AT],
    )
    await pool.query(
      `INSERT INTO review_sync_runs (property_id, source, mode, started_at)
       VALUES ($1, 'google', 'incremental', $2)`,
      [propertyId, AT],
    )
  }
  await pool.query(
    `INSERT INTO idempotency_receipts (scope, key, payload, recorded_at)
     VALUES ('gbp_webhook', $1, jsonb_build_object(
       'provider', 'google',
       'topic', 'reviews',
       'messageId', $1::text,
       'resolvedPropertyId', $2::text,
       'outcome', 'accepted'
     ), $3)`,
    [PROVIDER_MESSAGE_ID, PROPERTY_ID, AT],
  )
}

async function rowCounts(organizationId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const table of REVIEW_ORG_TABLES) {
    const result = await pool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM ${table} WHERE organization_id = $1`,
      [organizationId],
    )
    counts[table] = Number(result.rows[0]!.total)
  }
  return counts
}

/** A stable content fingerprint of everything Review holds for the tenant. */
async function contentSnapshot(organizationId: string): Promise<string> {
  const parts: string[] = []
  for (const table of REVIEW_ORG_TABLES) {
    const result = await pool.query<{ dump: string | null }>(
      `SELECT string_agg(row_dump, '|' ORDER BY row_dump) AS dump
       FROM (SELECT t::text AS row_dump FROM ${table} t
             WHERE t.organization_id = $1) AS rows`,
      [organizationId],
    )
    parts.push(`${table}=${result.rows[0]?.dump ?? ''}`)
  }
  const sync = await pool.query<{ dump: string | null }>(
    `SELECT string_agg(row_dump, '|' ORDER BY row_dump) AS dump
     FROM (SELECT s::text AS row_dump FROM review_sync_state s
           WHERE s.property_id IN
             (SELECT id::text FROM properties WHERE organization_id = $1)) AS rows`,
    [organizationId],
  )
  parts.push(`review_sync_state=${sync.rows[0]?.dump ?? ''}`)
  return parts.join('\n')
}

async function replyState(replyId: string): Promise<Record<string, unknown>> {
  const result = await pool.query(
    `SELECT text, status, publication_state FROM replies WHERE id = $1`,
    [replyId],
  )
  return result.rows[0] as Record<string, unknown>
}

async function armedSyncSchedules(organizationId: string): Promise<number> {
  const result = await pool.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM review_sync_state
     WHERE property_id IN (SELECT id::text FROM properties WHERE organization_id = $1)
       AND (next_incremental_at IS NOT NULL OR next_inventory_at IS NOT NULL
            OR error_retry_at IS NOT NULL)`,
    [organizationId],
  )
  return Number(result.rows[0]!.total)
}

/**
 * Drops this context's receipt so the SAME phase re-executes its SQL instead
 * of replaying the recorded outcome. Production cannot do this, which is
 * exactly why it is the only way to prove the statements are idempotent.
 */
async function forgetReviewReceipt(): Promise<void> {
  await withGuardsDisabled(async () => {
    await pool.query(
      `DELETE FROM context_organization_lifecycle_receipts
       WHERE organization_id = $1 AND context = 'review'`,
      [ORG_ID],
    )
  })
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
  await seedOrganizations()
  closureLineageId = randomUUID()
  closureStep = 0
})

describe.sequential('Review Organization lifecycle contributor (PostgreSQL)', () => {
  it('fences sync and pre-dispatch publication at closing without deleting a row', async () => {
    await seedReviewWork()
    const request = await advanceAuthorityTo('closure_requested')
    const before = await rowCounts(ORG_ID)
    expect(await armedSyncSchedules(ORG_ID)).toBe(1)

    const result =
      await createReviewOrganizationLifecycleContributor(db).prepareClosing(request)

    expect(result.outcome).toBe('complete')
    // No import and no sync: the Property is off every due scan.
    expect(await armedSyncSchedules(ORG_ID)).toBe(0)
    // No reply publication: the authorized-but-undispatched cycle is cancelled
    // and the Reply returns to draft, exactly as a policy denial leaves it.
    expect(await replyState(PENDING_REPLY_ID)).toEqual({
      text: REPLY_TEXT,
      status: 'draft',
      publication_state: 'cancelled',
    })
    // A Reply Google already published is provider truth and is left alone.
    expect(await replyState(PUBLISHED_REPLY_ID)).toEqual({
      text: REPLY_TEXT,
      status: 'published',
      publication_state: 'published',
    })
    // KEEP DATA: closure is recoverable, so not one row may disappear.
    expect(await rowCounts(ORG_ID)).toEqual(before)
    // The second tenant keeps its armed schedule.
    expect(await armedSyncSchedules(OTHER_ORG_ID)).toBe(1)
  })

  it('records a content-free receipt that leaks no provider or manager text', async () => {
    await seedReviewWork()
    const request = await advanceAuthorityTo('closure_requested')

    await createReviewOrganizationLifecycleContributor(db).prepareClosing(request)

    const receipts = await pool.query(
      `SELECT context, phase, outcome, evidence_ref, lifecycle_revision
       FROM context_organization_lifecycle_receipts
       WHERE organization_id = $1 AND closure_lineage_id = $2`,
      [ORG_ID, request.closureLineageId],
    )
    expect(receipts.rows).toEqual([
      {
        context: 'review',
        phase: 'closing',
        outcome: 'complete',
        evidence_ref: expect.stringMatching(/^review-lifecycle:closing:/u),
        lifecycle_revision: 1,
      },
    ])
    const evidenceRef = (receipts.rows[0] as { evidence_ref: string }).evidence_ref
    expect(evidenceRef).toMatch(/^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$/u)
    for (const secret of [GUEST_TEXT, GUEST_NAME, REPLY_TEXT, MANAGER_ID]) {
      expect(evidenceRef).not.toContain(secret)
    }
  })

  it('verifies purge readiness without mutating a single row', async () => {
    await seedReviewWork()
    const closing = await advanceAuthorityTo('closure_requested')
    await createReviewOrganizationLifecycleContributor(db).prepareClosing(closing)

    const readiness = await advanceAuthorityTo('closing')
    const before = await contentSnapshot(ORG_ID)

    const result =
      await createReviewOrganizationLifecycleContributor(db).verifyPurgeReadiness(
        readiness,
      )

    expect(result.outcome).toBe('complete')
    expect(await contentSnapshot(ORG_ID)).toBe(before)
  })

  it('fails closed while a provider write is still unsettled', async () => {
    await seedReviewWork()
    const closing = await advanceAuthorityTo('closure_requested')
    await createReviewOrganizationLifecycleContributor(db).prepareClosing(closing)
    // A reply whose provider write is in flight: closing deliberately does not
    // cancel it, so readiness must refuse to cross the irreversible boundary.
    await pool.query(`UPDATE replies SET publication_state = 'sending' WHERE id = $1`, [
      PENDING_REPLY_ID,
    ])
    const readiness = await advanceAuthorityTo('closing')

    await expect(
      createReviewOrganizationLifecycleContributor(db).verifyPurgeReadiness(readiness),
    ).rejects.toThrow('active_reply_publications=1')
    const receipts = await pool.query(
      `SELECT 1 FROM context_organization_lifecycle_receipts
       WHERE organization_id = $1 AND context = 'review' AND phase = 'purge_readiness'`,
      [ORG_ID],
    )
    expect(receipts.rowCount).toBe(0)
  })

  it('fails closed while sync scheduling is still armed', async () => {
    await seedReviewWork()
    const readiness = await advanceAuthorityTo('closing')

    await expect(
      createReviewOrganizationLifecycleContributor(db).verifyPurgeReadiness(readiness),
    ).rejects.toThrow('unfenced_sync_schedules=1')
  })

  it('erases provider and manager content while keeping the immutable authorization', async () => {
    await seedReviewWork()
    const otherBefore = await contentSnapshot(OTHER_ORG_ID)
    const request = await advanceAuthorityTo('purging')

    const result = await createReviewOrganizationLifecycleContributor(db).purge(request)

    expect(result.outcome).toBe('complete')
    const after = await rowCounts(ORG_ID)
    // Provider content, provider identifiers and the observation history go.
    for (const table of [
      'review_source_contents',
      'review_source_observations',
      'google_reply_observations',
      'google_reply_observation_heads',
      'reply_publication_attempts',
      'review_ai_analysis_heads',
      'review_provider_snapshot_runs',
    ]) {
      expect({ table, rows: after[table] }).toEqual({ table, rows: 0 })
    }
    // The immutable authorization survives; PostgreSQL would reject its
    // deletion anyway, and it is content-free evidence that a named manager
    // authorized one exact publication cycle.
    expect(after.reply_publication_authorizations).toBe(1)
    // The identity spine survives as scrubbed rows.
    expect(after.reviews).toBe(2)
    expect(after.replies).toBe(2)
    expect(after.material_review_revisions).toBe(2)

    const review = await pool.query(
      `SELECT source_content_state, external_id, reviewer_name, rating, text,
              translated_text, reviewed_at, sentiment_label
       FROM reviews WHERE id = $1`,
      [PUBLISHED_REVIEW_ID],
    )
    expect(review.rows[0]).toEqual({
      source_content_state: 'source_expired',
      external_id: null,
      reviewer_name: null,
      rating: null,
      text: null,
      translated_text: null,
      reviewed_at: null,
      sentiment_label: null,
    })
    const revision = await pool.query(
      `SELECT content_state, rating, normalized_text
       FROM material_review_revisions WHERE review_id = $1`,
      [PUBLISHED_REVIEW_ID],
    )
    expect(revision.rows[0]).toEqual({
      content_state: 'source_expired',
      rating: null,
      normalized_text: null,
    })
    expect(await replyState(PUBLISHED_REPLY_ID)).toEqual({
      text: '',
      status: 'published',
      publication_state: 'published',
    })

    // Nothing Review holds for the CLOSED tenant still carries its text. The
    // second tenant seeds the same strings, so the probe stays org-scoped.
    const leak = await pool.query<{ total: string }>(
      `SELECT (
         (SELECT count(*) FROM reviews
           WHERE organization_id = $5 AND (text = $1 OR reviewer_name = $2))
         + (SELECT count(*) FROM material_review_revisions
             WHERE organization_id = $5 AND normalized_text = $1)
         + (SELECT count(*) FROM replies WHERE organization_id = $5 AND text = $3)
         + (SELECT count(*) FROM idempotency_receipts
            WHERE scope = 'gbp_webhook' AND payload->>'messageId' = $4)
       )::text AS total`,
      [GUEST_TEXT, GUEST_NAME, REPLY_TEXT, PROVIDER_MESSAGE_ID, ORG_ID],
    )
    expect(leak.rows[0]!.total).toBe('0')

    // Sync scheduling and run history for the tenant's Properties are gone.
    expect(await armedSyncSchedules(ORG_ID)).toBe(0)
    // The second tenant is byte-identical.
    expect(await contentSnapshot(OTHER_ORG_ID)).toBe(otherBefore)
  })

  it('re-runs the purge safely against an already scrubbed Organization', async () => {
    await seedReviewWork()
    const request = await advanceAuthorityTo('purging')
    await createReviewOrganizationLifecycleContributor(db).purge(request)
    const afterFirst = await contentSnapshot(ORG_ID)

    // Forgetting the receipt forces the SQL to run a second time instead of
    // replaying the recorded outcome, which is what proves the statements
    // themselves converge on an already-scrubbed Organization.
    await forgetReviewReceipt()
    const result = await createReviewOrganizationLifecycleContributor(db).purge(request)

    expect(result.outcome).toBe('complete')
    expect(await contentSnapshot(ORG_ID)).toBe(afterFirst)
  })

  it('answers no_data for an Organization that never used Review', async () => {
    const request = await advanceAuthorityTo('closure_requested')

    const result =
      await createReviewOrganizationLifecycleContributor(db).prepareClosing(request)

    expect(result.outcome).toBe('no_data')
    const receipts = await pool.query(
      `SELECT outcome FROM context_organization_lifecycle_receipts
       WHERE organization_id = $1 AND context = 'review'`,
      [ORG_ID],
    )
    // Affirmative absence, never an omitted contributor.
    expect(receipts.rows).toEqual([{ outcome: 'no_data' }])
  })
})
