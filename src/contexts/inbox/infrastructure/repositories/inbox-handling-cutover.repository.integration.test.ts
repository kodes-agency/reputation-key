import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { organizationId } from '#/shared/domain/ids'
import { readInboxHandlingCutoverScan } from './inbox-handling-cutover.repository'

const ORG = 'org-inbox-handling-cutover-0001'
const PROPERTY = '7b000000-0000-4000-8000-000000000001'
const PORTAL = '7b000000-0000-4000-8000-000000000002'

const EXACT_REVIEW_ITEM = '7b000000-0000-4000-8000-000000000010'
const EXACT_REVIEW = '7b000000-0000-4000-8000-000000000011'
const EXACT_FEEDBACK_ITEM = '7b000000-0000-4000-8000-000000000012'
const EXACT_RESPONSE = '7b000000-0000-4000-8000-000000000013'
const MAPPABLE_ITEM = '7b000000-0000-4000-8000-000000000014'
const MAPPABLE_REVIEW = '7b000000-0000-4000-8000-000000000015'
const MISMATCH_ITEM = '7b000000-0000-4000-8000-000000000016'
const MISMATCH_REVIEW = '7b000000-0000-4000-8000-000000000017'
const CLOSED_UNPROVEN_ITEM = '7b000000-0000-4000-8000-000000000018'
const CLOSED_UNPROVEN_RESPONSE = '7b000000-0000-4000-8000-000000000019'
const ORPHAN_ITEM = '7b000000-0000-4000-8000-000000000020'
const ORPHAN_RESPONSE = '7b000000-0000-4000-8000-000000000021'

const WITHDRAWN_ITEM = '7b000000-0000-4000-8000-000000000030'
const WITHDRAWN_RESPONSE = '7b000000-0000-4000-8000-000000000031'
const HANDLED_ITEM = '7b000000-0000-4000-8000-000000000032'
const HANDLED_RESPONSE = '7b000000-0000-4000-8000-000000000033'
const HANDLED_OUTCOME = '7b000000-0000-4000-8000-000000000034'

const REOPENED_ITEM = '7b000000-0000-4000-8000-000000000040'
const REOPENED_RESPONSE = '7b000000-0000-4000-8000-000000000041'

const LATE_ITEM = '7b000000-0000-4000-8000-000000000050'
const LATE_RESPONSE = '7b000000-0000-4000-8000-000000000051'

const SEEDED_AT = new Date('2026-08-20T08:00:00.000Z')
const OBSERVED_AT = new Date('2026-08-27T12:00:00.000Z')
const AFTER_OBSERVED_AT = new Date('2026-08-28T09:00:00.000Z')

const db = getDb()
let pool: Pool

const CASCADING_TABLES = [
  'inbox_items',
  'guest_response_private_feedback',
  'guest_responses',
  'reviews',
  'portals',
  'properties',
] as const

async function clean(): Promise<void> {
  for (const table of CASCADING_TABLES) {
    await pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [ORG])
  }
  await deleteTestOrganizations(pool, [organizationId(ORG)])
}

async function seedScope(): Promise<void> {
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Inbox cutover test', 'inbox-cutover-test', $2)`,
    [ORG, SEEDED_AT],
  )
  await pool.query(
    `INSERT INTO properties (
       id, organization_id, name, slug, timezone, source_epoch, created_at, updated_at
     ) VALUES ($1, $2, 'Cutover property', 'cutover-property', 'UTC', 0, $3, $3)`,
    [PROPERTY, ORG, SEEDED_AT],
  )
  await pool.query(
    `INSERT INTO portals (
       id, organization_id, property_id, entity_type, entity_id, name, slug,
       created_by, created_at, updated_at
     ) VALUES ($1, $2, $3::uuid, 'property', $3::uuid::text, 'Cutover portal',
               'cutover-portal', 'operator-a', $4, $4)`,
    [PORTAL, ORG, PROPERTY, SEEDED_AT],
  )
}

async function seedReviewSource(reviewId: string, revisions = 1): Promise<void> {
  await pool.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id,
       external_location_id, rating, reviewed_at, expires_at,
       source_epoch, source_revision, source_observation_sequence,
       analysis_sequence, ai_source_byte_length, ai_source_digest,
       source_content_state, created_at, updated_at
     ) VALUES (
       $1, $2, $3, 'google', $4, 'locations/inbox-cutover', 4, $5, $6,
       0, 1, 0, 1, 1, $7, 'active', $5, $5
     )`,
    [
      reviewId,
      ORG,
      PROPERTY,
      `external-${reviewId}`,
      SEEDED_AT,
      new Date('2027-08-28T08:00:00.000Z'),
      '0'.repeat(64),
    ],
  )
  for (let revision = 1; revision <= revisions; revision += 1) {
    await pool.query(
      `INSERT INTO material_review_revisions (
         review_id, revision, organization_id, property_id, source_epoch,
         normalization_version, source_digest, normalized_digest, rating,
         normalized_text, response_target_eligibility, response_target_start_at,
         content_state, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 0, 'review-material-v1', $5, $5, 4,
                 'cutover marker text', 'legacy_unknown', NULL, 'active', $6, $6)`,
      [reviewId, revision, ORG, PROPERTY, '1'.repeat(64), SEEDED_AT],
    )
  }
}

async function seedGuestResponse(
  responseId: string,
  input?: Readonly<{ withdrawnAt?: Date; createdAt?: Date }>,
): Promise<void> {
  const createdAt = input?.createdAt ?? SEEDED_AT
  await pool.query(
    `INSERT INTO guest_responses (
       id, organization_id, property_id, portal_id, status, integrity_outcome,
       integrity_reason_code, integrity_revision, integrity_assessed_at, rating,
       response_consent, text_consent, submitted_at, feedback_submitted_at,
       feedback_submission_revision, feedback_withdrawn_at, retention_deadline,
       created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'submitted', 'accepted', 'submitted', 1, $5, 2,
               true, $6, $5, $5, 1, $7, $5::timestamptz + INTERVAL '24 months',
               $5, $5)`,
    [
      responseId,
      ORG,
      PROPERTY,
      PORTAL,
      createdAt,
      input?.withdrawnAt === undefined,
      input?.withdrawnAt ?? null,
    ],
  )
  if (input?.withdrawnAt === undefined) {
    await pool.query(
      `INSERT INTO guest_response_private_feedback (
         response_id, organization_id, property_id, portal_id, body,
         submitted_at, expires_at, created_at
       ) VALUES ($1, $2, $3, $4, 'PRIVATE-FEEDBACK-MARKER', $5,
                 $5::timestamptz + INTERVAL '24 months', $5)`,
      [responseId, ORG, PROPERTY, PORTAL, createdAt],
    )
  }
}

type ItemSeed = Readonly<{
  id: string
  sourceType: 'review' | 'feedback'
  sourceId: string
  status: 'open' | 'closed'
  closedAt?: Date | null
  createdAt?: Date
}>

async function seedItem(seed: ItemSeed): Promise<void> {
  const isReview = seed.sourceType === 'review'
  await pool.query(
    `INSERT INTO inbox_items (
       id, organization_id, property_id, source_type, source_id, status,
       rating, source_date, platform, snippet, reviewer_name, closed_at,
       command_revision, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 1, $13, $13)`,
    [
      seed.id,
      ORG,
      PROPERTY,
      seed.sourceType,
      seed.sourceId,
      seed.status,
      isReview ? null : 2,
      SEEDED_AT,
      isReview ? 'google' : null,
      isReview ? null : 'SNIPPET-MARKER',
      isReview ? null : 'REVIEWER-MARKER',
      seed.closedAt ?? null,
      seed.createdAt ?? SEEDED_AT,
    ],
  )
}

type CycleSeed = Readonly<{
  itemId: string
  cycleNumber: number
  sourceType: 'review' | 'feedback'
  sourceId: string
  sourceRevision: number
  openedReason: string
  supersedes?: number | null
  createdAt?: Date
}>

async function seedCycle(seed: CycleSeed): Promise<void> {
  const isReview = seed.sourceType === 'review'
  await pool.query(
    `INSERT INTO inbox_handling_cycles (
       inbox_item_id, cycle_number, organization_id, property_id, source_type,
       source_id, source_revision, review_id, material_review_revision,
       opened_reason, supersedes_cycle_number, opened_by, opened_at, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULL, $12, $12)`,
    [
      seed.itemId,
      seed.cycleNumber,
      ORG,
      PROPERTY,
      seed.sourceType,
      seed.sourceId,
      seed.sourceRevision,
      isReview ? seed.sourceId : null,
      isReview ? seed.sourceRevision : null,
      seed.openedReason,
      seed.supersedes ?? null,
      seed.createdAt ?? SEEDED_AT,
    ],
  )
}

type HeadSeed = Readonly<{
  itemId: string
  sourceType: 'review' | 'feedback'
  sourceId: string
  cycleNumber: number
  sourceRevision: number
  stateRevision: number
  status: 'open' | 'closed'
  createdAt?: Date
}>

async function seedHead(seed: HeadSeed): Promise<void> {
  const isReview = seed.sourceType === 'review'
  await pool.query(
    `INSERT INTO inbox_handling_cycle_heads (
       inbox_item_id, organization_id, property_id, source_type, source_id,
       current_source_revision, review_id, current_cycle_number,
       current_material_review_revision, state_revision, status,
       created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
    [
      seed.itemId,
      ORG,
      PROPERTY,
      seed.sourceType,
      seed.sourceId,
      seed.sourceRevision,
      isReview ? seed.sourceId : null,
      seed.cycleNumber,
      isReview ? seed.sourceRevision : null,
      seed.stateRevision,
      seed.status,
      seed.createdAt ?? SEEDED_AT,
    ],
  )
}

type TransitionSeed = Readonly<{
  itemId: string
  stateRevision: number
  cycleNumber: number
  sourceType: 'review' | 'feedback'
  sourceId: string
  sourceRevision: number
  kind: 'opened' | 'closed' | 'reopened'
  reason: string
  createdAt?: Date
}>

async function seedTransition(seed: TransitionSeed): Promise<void> {
  await pool.query(
    `INSERT INTO inbox_handling_cycle_transitions (
       inbox_item_id, state_revision, cycle_number, organization_id,
       property_id, source_type, source_id, source_revision, kind,
       transition_reason, actor_type, actor_user_id, trigger_event_id,
       transitioned_at, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'system', NULL, NULL,
               $11, $11)`,
    [
      seed.itemId,
      seed.stateRevision,
      seed.cycleNumber,
      ORG,
      PROPERTY,
      seed.sourceType,
      seed.sourceId,
      seed.sourceRevision,
      seed.kind,
      seed.reason,
      seed.createdAt ?? SEEDED_AT,
    ],
  )
}

type TargetSeed = Readonly<{
  itemId: string
  cycleNumber: number
  sourceType: 'review' | 'feedback'
  sourceId: string
  sourceRevision: number
  targetKind: 'google_review_response' | 'private_feedback_handling'
  eligibility: 'measured' | 'legacy_unknown' | 'historical_onboarding'
  result?: 'on_time' | 'late' | 'cancelled' | null
  stopReason?: string | null
  createdAt?: Date
}>

async function seedResponseTarget(seed: TargetSeed): Promise<void> {
  const measured = seed.eligibility === 'measured'
  await pool.query(
    `INSERT INTO inbox_handling_cycle_response_targets (
       inbox_item_id, cycle_number, organization_id, property_id, source_type,
       source_id, source_revision, target_kind, performance_eligibility,
       duration_minutes, policy_source, policy_version, start_at, due_at,
       completion_at, result, stop_reason, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
               $10, $11, $12, $13, $14, $15, $16, $17, $18, $18)`,
    [
      seed.itemId,
      seed.cycleNumber,
      ORG,
      PROPERTY,
      seed.sourceType,
      seed.sourceId,
      seed.sourceRevision,
      seed.targetKind,
      seed.eligibility,
      measured ? 60 : null,
      measured ? 'organization_policy' : null,
      measured ? 1 : null,
      measured ? SEEDED_AT : null,
      measured ? new Date(SEEDED_AT.getTime() + 60 * 60 * 1000) : null,
      seed.result ? new Date(SEEDED_AT.getTime() + 30 * 60 * 1000) : null,
      seed.result ?? null,
      seed.stopReason ?? null,
      seed.createdAt ?? SEEDED_AT,
    ],
  )
}

/** The six-row cutover fixture named by the IBX-01-T2 acceptance criteria. */
async function seedCutoverFixture(): Promise<void> {
  await seedScope()

  // 1. exact review item — open, head agrees with the cycle log.
  await seedReviewSource(EXACT_REVIEW)
  await seedItem({
    id: EXACT_REVIEW_ITEM,
    sourceType: 'review',
    sourceId: EXACT_REVIEW,
    status: 'open',
  })
  await seedCycle({
    itemId: EXACT_REVIEW_ITEM,
    cycleNumber: 1,
    sourceType: 'review',
    sourceId: EXACT_REVIEW,
    sourceRevision: 1,
    openedReason: 'review_observed',
  })
  await seedTransition({
    itemId: EXACT_REVIEW_ITEM,
    stateRevision: 1,
    cycleNumber: 1,
    sourceType: 'review',
    sourceId: EXACT_REVIEW,
    sourceRevision: 1,
    kind: 'opened',
    reason: 'review_observed',
  })
  await seedHead({
    itemId: EXACT_REVIEW_ITEM,
    sourceType: 'review',
    sourceId: EXACT_REVIEW,
    cycleNumber: 1,
    sourceRevision: 1,
    stateRevision: 1,
    status: 'open',
  })

  // 2. exact feedback item.
  await seedGuestResponse(EXACT_RESPONSE)
  await seedItem({
    id: EXACT_FEEDBACK_ITEM,
    sourceType: 'feedback',
    sourceId: EXACT_RESPONSE,
    status: 'open',
  })
  await seedCycle({
    itemId: EXACT_FEEDBACK_ITEM,
    cycleNumber: 1,
    sourceType: 'feedback',
    sourceId: EXACT_RESPONSE,
    sourceRevision: 1,
    openedReason: 'feedback_submitted',
  })
  await seedTransition({
    itemId: EXACT_FEEDBACK_ITEM,
    stateRevision: 1,
    cycleNumber: 1,
    sourceType: 'feedback',
    sourceId: EXACT_RESPONSE,
    sourceRevision: 1,
    kind: 'opened',
    reason: 'feedback_submitted',
  })
  await seedHead({
    itemId: EXACT_FEEDBACK_ITEM,
    sourceType: 'feedback',
    sourceId: EXACT_RESPONSE,
    cycleNumber: 1,
    sourceRevision: 1,
    stateRevision: 1,
    status: 'open',
  })

  // 3. headless review item — one live anchor, nothing migrated.
  await seedReviewSource(MAPPABLE_REVIEW)
  await seedItem({
    id: MAPPABLE_ITEM,
    sourceType: 'review',
    sourceId: MAPPABLE_REVIEW,
    status: 'open',
  })

  // 4. compatibility mirror disagrees with the head.
  await seedReviewSource(MISMATCH_REVIEW)
  await seedItem({
    id: MISMATCH_ITEM,
    sourceType: 'review',
    sourceId: MISMATCH_REVIEW,
    status: 'closed',
    closedAt: SEEDED_AT,
  })
  await seedCycle({
    itemId: MISMATCH_ITEM,
    cycleNumber: 1,
    sourceType: 'review',
    sourceId: MISMATCH_REVIEW,
    sourceRevision: 1,
    openedReason: 'review_observed',
  })
  await seedTransition({
    itemId: MISMATCH_ITEM,
    stateRevision: 1,
    cycleNumber: 1,
    sourceType: 'review',
    sourceId: MISMATCH_REVIEW,
    sourceRevision: 1,
    kind: 'opened',
    reason: 'review_observed',
  })
  await seedHead({
    itemId: MISMATCH_ITEM,
    sourceType: 'review',
    sourceId: MISMATCH_REVIEW,
    cycleNumber: 1,
    sourceRevision: 1,
    stateRevision: 1,
    status: 'open',
  })

  // 5. closed private feedback with no outcome row — closedAt proves nothing.
  await seedGuestResponse(CLOSED_UNPROVEN_RESPONSE)
  await seedItem({
    id: CLOSED_UNPROVEN_ITEM,
    sourceType: 'feedback',
    sourceId: CLOSED_UNPROVEN_RESPONSE,
    status: 'closed',
    closedAt: SEEDED_AT,
  })
  await seedCycle({
    itemId: CLOSED_UNPROVEN_ITEM,
    cycleNumber: 1,
    sourceType: 'feedback',
    sourceId: CLOSED_UNPROVEN_RESPONSE,
    sourceRevision: 1,
    openedReason: 'feedback_submitted',
  })
  await seedTransition({
    itemId: CLOSED_UNPROVEN_ITEM,
    stateRevision: 1,
    cycleNumber: 1,
    sourceType: 'feedback',
    sourceId: CLOSED_UNPROVEN_RESPONSE,
    sourceRevision: 1,
    kind: 'opened',
    reason: 'feedback_submitted',
  })
  await seedTransition({
    itemId: CLOSED_UNPROVEN_ITEM,
    stateRevision: 2,
    cycleNumber: 1,
    sourceType: 'feedback',
    sourceId: CLOSED_UNPROVEN_RESPONSE,
    sourceRevision: 1,
    kind: 'closed',
    reason: 'private_feedback_handled',
  })
  await seedHead({
    itemId: CLOSED_UNPROVEN_ITEM,
    sourceType: 'feedback',
    sourceId: CLOSED_UNPROVEN_RESPONSE,
    cycleNumber: 1,
    sourceRevision: 1,
    stateRevision: 2,
    status: 'closed',
  })

  // 6. the guest response behind this item is gone; the Inbox row survived.
  await seedItem({
    id: ORPHAN_ITEM,
    sourceType: 'feedback',
    sourceId: ORPHAN_RESPONSE,
    status: 'open',
  })
  await seedCycle({
    itemId: ORPHAN_ITEM,
    cycleNumber: 1,
    sourceType: 'feedback',
    sourceId: ORPHAN_RESPONSE,
    sourceRevision: 1,
    openedReason: 'legacy_backfill',
  })
  await seedTransition({
    itemId: ORPHAN_ITEM,
    stateRevision: 1,
    cycleNumber: 1,
    sourceType: 'feedback',
    sourceId: ORPHAN_RESPONSE,
    sourceRevision: 1,
    kind: 'opened',
    reason: 'legacy_backfill',
  })
  await seedHead({
    itemId: ORPHAN_ITEM,
    sourceType: 'feedback',
    sourceId: ORPHAN_RESPONSE,
    cycleNumber: 1,
    sourceRevision: 1,
    stateRevision: 1,
    status: 'open',
  })
}

const scan = () =>
  readInboxHandlingCutoverScan(db, { organizationId: ORG, observedAt: OBSERVED_AT })

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  const client = await pool.connect()
  client.release()
})

afterAll(async () => {
  await clean()
  await pool.end()
})

beforeEach(async () => {
  await clean()
})

describe.sequential('Inbox handling-cycle cutover repository (PostgreSQL)', () => {
  it('reads inside one READ ONLY, REPEATABLE READ transaction and writes nothing', async () => {
    await seedCutoverFixture()
    const before = await pool.query<{ digest: string }>(
      `SELECT count(*)::text || ':' || coalesce(max(updated_at)::text, '-') AS digest
       FROM inbox_items WHERE organization_id = $1`,
      [ORG],
    )

    const result = await scan()

    expect(result.transaction).toEqual({
      readOnly: true,
      isolationLevel: 'repeatable read',
      writeTransactionAssigned: false,
    })
    const after = await pool.query<{ digest: string }>(
      `SELECT count(*)::text || ':' || coalesce(max(updated_at)::text, '-') AS digest
       FROM inbox_items WHERE organization_id = $1`,
      [ORG],
    )
    expect(after.rows[0]?.digest).toBe(before.rows[0]?.digest)
  })

  it('classifies the fixture as exact 2, mappable 1, ambiguous 2, orphan 1', async () => {
    await seedCutoverFixture()

    const result = await scan()

    const byId = new Map(
      result.relationships.map((relationship) => [
        relationship.inboxItemId,
        relationship,
      ]),
    )
    expect(byId.get(EXACT_REVIEW_ITEM)?.classification).toBe('exact')
    expect(byId.get(EXACT_FEEDBACK_ITEM)?.classification).toBe('exact')
    expect(byId.get(MAPPABLE_ITEM)?.classification).toBe('mappable')
    expect(byId.get(MISMATCH_ITEM)?.reasonCode).toBe('status_mirror_disagrees_with_head')
    expect(byId.get(CLOSED_UNPROVEN_ITEM)?.reasonCode).toBe(
      'closed_without_handling_evidence',
    )
    expect(byId.get(ORPHAN_ITEM)?.reasonCode).toBe('source_row_missing')
    expect(result.totals).toEqual({
      total: 6,
      exact: 2,
      mappable: 1,
      ambiguous: 2,
      orphan: 1,
    })
  })

  it('reconciles item counts against heads and reports every status mirror drift by id', async () => {
    await seedCutoverFixture()

    const result = await scan()

    expect(result.parity.inboxItemCount).toBe(
      result.parity.handlingCycleHeadCount + result.parity.orphanCount,
    )
    expect(result.parity.inboxItemCount).toBe(6)
    expect(result.parity.handlingCycleHeadCount).toBe(5)
    expect(result.parity.statusMismatches).toEqual([
      { inboxItemId: MISMATCH_ITEM, itemStatus: 'closed', headStatus: 'open' },
    ])
  })

  it('reports guest_withdrawn feedback as withdrawn and keeps it out of the handled tallies', async () => {
    await seedScope()
    await seedGuestResponse(WITHDRAWN_RESPONSE, { withdrawnAt: SEEDED_AT })
    await seedItem({
      id: WITHDRAWN_ITEM,
      sourceType: 'feedback',
      sourceId: WITHDRAWN_RESPONSE,
      status: 'closed',
      closedAt: SEEDED_AT,
    })
    await seedCycle({
      itemId: WITHDRAWN_ITEM,
      cycleNumber: 1,
      sourceType: 'feedback',
      sourceId: WITHDRAWN_RESPONSE,
      sourceRevision: 1,
      openedReason: 'feedback_submitted',
    })
    await seedTransition({
      itemId: WITHDRAWN_ITEM,
      stateRevision: 1,
      cycleNumber: 1,
      sourceType: 'feedback',
      sourceId: WITHDRAWN_RESPONSE,
      sourceRevision: 1,
      kind: 'opened',
      reason: 'feedback_submitted',
    })
    await seedTransition({
      itemId: WITHDRAWN_ITEM,
      stateRevision: 2,
      cycleNumber: 1,
      sourceType: 'feedback',
      sourceId: WITHDRAWN_RESPONSE,
      sourceRevision: 1,
      kind: 'closed',
      reason: 'guest_withdrawn',
    })
    await seedHead({
      itemId: WITHDRAWN_ITEM,
      sourceType: 'feedback',
      sourceId: WITHDRAWN_RESPONSE,
      cycleNumber: 1,
      sourceRevision: 1,
      stateRevision: 2,
      status: 'closed',
    })
    await seedResponseTarget({
      itemId: WITHDRAWN_ITEM,
      cycleNumber: 1,
      sourceType: 'feedback',
      sourceId: WITHDRAWN_RESPONSE,
      sourceRevision: 1,
      targetKind: 'private_feedback_handling',
      eligibility: 'measured',
      result: 'cancelled',
      stopReason: 'guest_withdrawn',
    })

    await seedGuestResponse(HANDLED_RESPONSE)
    await seedItem({
      id: HANDLED_ITEM,
      sourceType: 'feedback',
      sourceId: HANDLED_RESPONSE,
      status: 'closed',
      closedAt: SEEDED_AT,
    })
    await seedCycle({
      itemId: HANDLED_ITEM,
      cycleNumber: 1,
      sourceType: 'feedback',
      sourceId: HANDLED_RESPONSE,
      sourceRevision: 1,
      openedReason: 'feedback_submitted',
    })
    await seedTransition({
      itemId: HANDLED_ITEM,
      stateRevision: 1,
      cycleNumber: 1,
      sourceType: 'feedback',
      sourceId: HANDLED_RESPONSE,
      sourceRevision: 1,
      kind: 'opened',
      reason: 'feedback_submitted',
    })
    await seedTransition({
      itemId: HANDLED_ITEM,
      stateRevision: 2,
      cycleNumber: 1,
      sourceType: 'feedback',
      sourceId: HANDLED_RESPONSE,
      sourceRevision: 1,
      kind: 'closed',
      reason: 'private_feedback_handled',
    })
    await seedHead({
      itemId: HANDLED_ITEM,
      sourceType: 'feedback',
      sourceId: HANDLED_RESPONSE,
      cycleNumber: 1,
      sourceRevision: 1,
      stateRevision: 2,
      status: 'closed',
    })
    await pool.query(
      `INSERT INTO inbox_feedback_handling_outcomes (
         id, inbox_item_id, cycle_number, outcome_revision, organization_id,
         property_id, source_type, feedback_id, source_revision, outcome,
         internal_note, recorded_by, recorded_at, completion_at,
         completion_state_revision, deadline_result, resulting_command_revision,
         created_at
       ) VALUES ($1, $2, 1, 1, $3, $4, 'feedback', $5, 1, 'follow_up_completed',
                 'INTERNAL-NOTE-MARKER', 'user-manager', $6, $6, 2, 'on_time', 2, $6)`,
      [HANDLED_OUTCOME, HANDLED_ITEM, ORG, PROPERTY, HANDLED_RESPONSE, SEEDED_AT],
    )

    const result = await scan()

    const outcomes = new Map(
      result.outcomes.map((outcome) => [outcome.inboxItemId, outcome]),
    )
    expect(outcomes.get(WITHDRAWN_ITEM)?.outcomeEligibility).toBe('withdrawn')
    expect(outcomes.get(HANDLED_ITEM)?.outcomeEligibility).toBe('handled_on_time')
    expect(result.outcomeTallies.withdrawn).toBe(1)
    expect(result.outcomeTallies.handledOnTime).toBe(1)
    expect(result.outcomeTallies.handledLate).toBe(0)
  })

  it('bounds the scan at --observed-at so a later row is absent', async () => {
    await seedCutoverFixture()
    await seedGuestResponse(LATE_RESPONSE, { createdAt: AFTER_OBSERVED_AT })
    await seedItem({
      id: LATE_ITEM,
      sourceType: 'feedback',
      sourceId: LATE_RESPONSE,
      status: 'open',
      createdAt: AFTER_OBSERVED_AT,
    })

    const result = await scan()

    expect(
      result.relationships.some((relationship) => relationship.inboxItemId === LATE_ITEM),
    ).toBe(false)
    expect(result.totals.total).toBe(6)
  })

  it('reports a response target on a superseded cycle as superseded, not ambiguous', async () => {
    await seedScope()
    await seedGuestResponse(REOPENED_RESPONSE)
    await seedItem({
      id: REOPENED_ITEM,
      sourceType: 'feedback',
      sourceId: REOPENED_RESPONSE,
      status: 'open',
    })
    await seedCycle({
      itemId: REOPENED_ITEM,
      cycleNumber: 1,
      sourceType: 'feedback',
      sourceId: REOPENED_RESPONSE,
      sourceRevision: 1,
      openedReason: 'feedback_submitted',
    })
    await seedCycle({
      itemId: REOPENED_ITEM,
      cycleNumber: 2,
      sourceType: 'feedback',
      sourceId: REOPENED_RESPONSE,
      sourceRevision: 2,
      openedReason: 'feedback_submitted',
      supersedes: 1,
    })
    await seedTransition({
      itemId: REOPENED_ITEM,
      stateRevision: 1,
      cycleNumber: 1,
      sourceType: 'feedback',
      sourceId: REOPENED_RESPONSE,
      sourceRevision: 1,
      kind: 'opened',
      reason: 'feedback_submitted',
    })
    await seedTransition({
      itemId: REOPENED_ITEM,
      stateRevision: 2,
      cycleNumber: 1,
      sourceType: 'feedback',
      sourceId: REOPENED_RESPONSE,
      sourceRevision: 1,
      kind: 'closed',
      reason: 'superseded_by_source_revision',
    })
    await seedTransition({
      itemId: REOPENED_ITEM,
      stateRevision: 3,
      cycleNumber: 2,
      sourceType: 'feedback',
      sourceId: REOPENED_RESPONSE,
      sourceRevision: 2,
      kind: 'opened',
      reason: 'feedback_submitted',
    })
    await seedHead({
      itemId: REOPENED_ITEM,
      sourceType: 'feedback',
      sourceId: REOPENED_RESPONSE,
      cycleNumber: 2,
      sourceRevision: 2,
      stateRevision: 3,
      status: 'open',
    })
    await seedResponseTarget({
      itemId: REOPENED_ITEM,
      cycleNumber: 1,
      sourceType: 'feedback',
      sourceId: REOPENED_RESPONSE,
      sourceRevision: 1,
      targetKind: 'private_feedback_handling',
      eligibility: 'measured',
      result: 'cancelled',
      stopReason: 'superseded_by_source_revision',
    })
    await seedResponseTarget({
      itemId: REOPENED_ITEM,
      cycleNumber: 2,
      sourceType: 'feedback',
      sourceId: REOPENED_RESPONSE,
      sourceRevision: 2,
      targetKind: 'private_feedback_handling',
      eligibility: 'measured',
    })

    const result = await scan()

    expect(result.responseTargets).toEqual([
      {
        inboxItemId: REOPENED_ITEM,
        cycleNumber: 1,
        headCycleNumber: 2,
        targetKind: 'private_feedback_handling',
        performanceEligibility: 'measured',
        result: 'cancelled',
        state: 'superseded',
      },
      {
        inboxItemId: REOPENED_ITEM,
        cycleNumber: 2,
        headCycleNumber: 2,
        targetKind: 'private_feedback_handling',
        performanceEligibility: 'measured',
        result: null,
        state: 'current',
      },
    ])
    expect(
      result.relationships.find(
        (relationship) => relationship.inboxItemId === REOPENED_ITEM,
      )?.classification,
    ).toBe('exact')
  })

  it('never reads guest, reviewer, or manager prose into the scan', async () => {
    await seedCutoverFixture()

    const result = await scan()

    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('MARKER')
    expect(serialized).not.toContain('cutover marker text')
  })
})
