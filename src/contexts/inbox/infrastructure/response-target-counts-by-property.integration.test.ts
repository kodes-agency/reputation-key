import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  type InboxItemId,
  type PropertyId,
  type ReviewId,
} from '#/shared/domain/ids'

import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { createResponseTargetStore } from './response-target.store'

const ORG = organizationId('org-response-target-property-counts')
const OVERDUE_PROPERTY = propertyId('7a100000-0000-4000-8000-000000000001')
const ACTIVE_PROPERTY = propertyId('7a100000-0000-4000-8000-000000000002')
const EMPTY_PROPERTY = propertyId('7a100000-0000-4000-8000-000000000003')

const OVERDUE_ITEM = inboxItemId('7a100000-0000-4000-8000-000000000101')
const ACTIVE_ITEM = inboxItemId('7a100000-0000-4000-8000-000000000102')
const CLOSED_ITEM = inboxItemId('7a100000-0000-4000-8000-000000000103')
const PRIVATE_FEEDBACK_ITEM = inboxItemId('7a100000-0000-4000-8000-000000000104')
const NON_MEASURED_ITEM = inboxItemId('7a100000-0000-4000-8000-000000000105')
const COMPLETED_ITEM = inboxItemId('7a100000-0000-4000-8000-000000000106')

const OVERDUE_REVIEW = reviewId('7a100000-0000-4000-8000-000000000201')
const ACTIVE_REVIEW = reviewId('7a100000-0000-4000-8000-000000000202')
const CLOSED_REVIEW = reviewId('7a100000-0000-4000-8000-000000000203')
const NON_MEASURED_REVIEW = reviewId('7a100000-0000-4000-8000-000000000205')
const COMPLETED_REVIEW = reviewId('7a100000-0000-4000-8000-000000000206')
const PRIVATE_FEEDBACK = feedbackId('7a100000-0000-4000-8000-000000000301')

const NOW = new Date('2026-09-03T12:00:00.000Z')
const STARTED_AT = new Date('2026-09-03T10:00:00.000Z')
const OVERDUE_AT = new Date('2026-09-03T11:00:00.000Z')
const ACTIVE_STARTED_AT = new Date('2026-09-03T11:30:00.000Z')
const ACTIVE_DUE_AT = new Date('2026-09-03T12:30:00.000Z')
const COMPLETED_AT = new Date('2026-09-03T10:30:00.000Z')

const db = getDb()
let pool: Pool

type ReviewTargetFixture = Readonly<{
  itemId: InboxItemId
  reviewId: ReviewId
  propertyId: PropertyId
  eligibility: 'measured' | 'historical_onboarding'
  headStatus?: 'open' | 'closed'
  startAt: Date | null
  dueAt: Date | null
  completionAt?: Date | null
  result?: 'on_time' | null
  stopReason?: 'confirmed_on_google' | null
}>

async function clean(): Promise<void> {
  await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await deleteTestOrganizations(pool, [ORG])
}

async function seedScope(): Promise<void> {
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Response Target Property Counts', 'response-target-property-counts', $2)`,
    [ORG, STARTED_AT],
  )
  await pool.query(
    `INSERT INTO properties (
       id, organization_id, name, slug, timezone, source_epoch, created_at, updated_at
     ) VALUES
       ($1, $4, 'Overdue Property', 'overdue-property', 'UTC', 0, $5, $5),
       ($2, $4, 'Active Property', 'active-property', 'UTC', 0, $5, $5),
       ($3, $4, 'Empty Property', 'empty-property', 'UTC', 0, $5, $5)`,
    [OVERDUE_PROPERTY, ACTIVE_PROPERTY, EMPTY_PROPERTY, ORG, STARTED_AT],
  )
}

async function seedReviewTarget(input: ReviewTargetFixture): Promise<void> {
  const headStatus = input.headStatus ?? 'open'
  const durationMinutes = input.eligibility === 'measured' ? 60 : null
  const policySource = input.eligibility === 'measured' ? 'builtin_default' : null
  const policyVersion = input.eligibility === 'measured' ? 1 : null
  const completionAt = input.completionAt ?? null
  const result = input.result ?? null
  const stopReason = input.stopReason ?? null

  await pool.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id,
       external_location_id, rating, reviewed_at, expires_at,
       source_epoch, source_revision, source_observation_sequence,
       analysis_sequence, ai_source_byte_length, ai_source_digest,
       source_content_state, created_at, updated_at
     ) VALUES (
       $1, $2, $3, 'google', $4, 'locations/response-target-property-counts',
       4, $5, $6, 0, 1, 0, 1, 1, $7, 'active', $5, $5
     )`,
    [
      input.reviewId,
      ORG,
      input.propertyId,
      `external-${input.reviewId}`,
      STARTED_AT,
      new Date('2027-09-03T10:00:00.000Z'),
      '0'.repeat(64),
    ],
  )
  await pool.query(
    `INSERT INTO material_review_revisions (
       review_id, revision, organization_id, property_id, source_epoch,
       normalization_version, source_digest, normalized_digest, rating,
       normalized_text, response_target_eligibility, response_target_start_at,
       content_state, created_at, updated_at
     ) VALUES (
       $1, 1, $2, $3, 0, 'review-material-v1', $4, $4, 4,
       'response target property count fixture', $5, $6, 'active', $7, $7
     )`,
    [
      input.reviewId,
      ORG,
      input.propertyId,
      '1'.repeat(64),
      input.eligibility,
      input.startAt,
      STARTED_AT,
    ],
  )
  await pool.query(
    `INSERT INTO inbox_items (
       id, organization_id, property_id, source_type, source_id, status,
       source_date, platform, closed_at, command_revision, created_at, updated_at
     ) VALUES ($1, $2, $3, 'review', $4, $5, $6, 'google', $7, 1, $6, $6)`,
    [
      input.itemId,
      ORG,
      input.propertyId,
      input.reviewId,
      headStatus,
      STARTED_AT,
      headStatus === 'closed' ? NOW : null,
    ],
  )
  await pool.query(
    `INSERT INTO inbox_handling_cycles (
       inbox_item_id, cycle_number, organization_id, property_id,
       source_type, source_id, source_revision, review_id,
       material_review_revision, opened_reason, opened_at, created_at
     ) VALUES ($1, 1, $2, $3, 'review', $4, 1, $4, 1,
               'review_observed', $5, $5)`,
    [input.itemId, ORG, input.propertyId, input.reviewId, STARTED_AT],
  )
  await pool.query(
    `INSERT INTO inbox_handling_cycle_heads (
       inbox_item_id, organization_id, property_id, source_type, source_id,
       current_source_revision, review_id, current_cycle_number,
       current_material_review_revision, state_revision, status, created_at, updated_at
     ) VALUES ($1, $2, $3, 'review', $4, 1, $4, 1, 1, 1, $5, $6, $6)`,
    [input.itemId, ORG, input.propertyId, input.reviewId, headStatus, STARTED_AT],
  )
  await pool.query(
    `INSERT INTO inbox_handling_cycle_response_targets (
       inbox_item_id, cycle_number, organization_id, property_id,
       source_type, source_id, source_revision, target_kind,
       performance_eligibility, duration_minutes, policy_source, policy_version,
       start_at, due_at, completion_at, result, stop_reason, created_at, updated_at
     ) VALUES (
       $1, 1, $2, $3, 'review', $4, 1, 'google_review_response',
       $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14
     )`,
    [
      input.itemId,
      ORG,
      input.propertyId,
      input.reviewId,
      input.eligibility,
      durationMinutes,
      policySource,
      policyVersion,
      input.startAt,
      input.dueAt,
      completionAt,
      result,
      stopReason,
      STARTED_AT,
    ],
  )
}

async function seedPrivateFeedbackTarget(): Promise<void> {
  await pool.query(
    `INSERT INTO inbox_items (
       id, organization_id, property_id, source_type, source_id, status,
       rating, source_date, snippet, command_revision, created_at, updated_at
     ) VALUES ($1, $2, $3, 'feedback', $4, 'open', 2, $5,
               'private feedback', 1, $5, $5)`,
    [PRIVATE_FEEDBACK_ITEM, ORG, OVERDUE_PROPERTY, PRIVATE_FEEDBACK, STARTED_AT],
  )
  await pool.query(
    `INSERT INTO inbox_handling_cycles (
       inbox_item_id, cycle_number, organization_id, property_id,
       source_type, source_id, source_revision, opened_reason, opened_at, created_at
     ) VALUES ($1, 1, $2, $3, 'feedback', $4, 1,
               'feedback_submitted', $5, $5)`,
    [PRIVATE_FEEDBACK_ITEM, ORG, OVERDUE_PROPERTY, PRIVATE_FEEDBACK, STARTED_AT],
  )
  await pool.query(
    `INSERT INTO inbox_handling_cycle_heads (
       inbox_item_id, organization_id, property_id, source_type, source_id,
       current_source_revision, current_cycle_number, state_revision,
       status, created_at, updated_at
     ) VALUES ($1, $2, $3, 'feedback', $4, 1, 1, 1, 'open', $5, $5)`,
    [PRIVATE_FEEDBACK_ITEM, ORG, OVERDUE_PROPERTY, PRIVATE_FEEDBACK, STARTED_AT],
  )
  await pool.query(
    `INSERT INTO inbox_handling_cycle_response_targets (
       inbox_item_id, cycle_number, organization_id, property_id,
       source_type, source_id, source_revision, target_kind,
       performance_eligibility, duration_minutes, policy_source, policy_version,
       start_at, due_at, created_at, updated_at
     ) VALUES ($1, 1, $2, $3, 'feedback', $4, 1,
               'private_feedback_handling', 'measured', 60, 'builtin_default', 1,
               $5, $6, $5, $5)`,
    [
      PRIVATE_FEEDBACK_ITEM,
      ORG,
      OVERDUE_PROPERTY,
      PRIVATE_FEEDBACK,
      STARTED_AT,
      OVERDUE_AT,
    ],
  )
}

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

describe.sequential(
  'Google Review Response Target counts by Property (PostgreSQL)',
  () => {
    it('counts only measured, open, current, uncompleted Google targets in one statement', async () => {
      await seedScope()
      await seedReviewTarget({
        itemId: OVERDUE_ITEM,
        reviewId: OVERDUE_REVIEW,
        propertyId: OVERDUE_PROPERTY,
        eligibility: 'measured',
        startAt: STARTED_AT,
        dueAt: OVERDUE_AT,
      })
      await seedReviewTarget({
        itemId: ACTIVE_ITEM,
        reviewId: ACTIVE_REVIEW,
        propertyId: ACTIVE_PROPERTY,
        eligibility: 'measured',
        startAt: ACTIVE_STARTED_AT,
        dueAt: ACTIVE_DUE_AT,
      })
      await seedReviewTarget({
        itemId: CLOSED_ITEM,
        reviewId: CLOSED_REVIEW,
        propertyId: OVERDUE_PROPERTY,
        eligibility: 'measured',
        headStatus: 'closed',
        startAt: STARTED_AT,
        dueAt: OVERDUE_AT,
      })
      await seedPrivateFeedbackTarget()
      await seedReviewTarget({
        itemId: NON_MEASURED_ITEM,
        reviewId: NON_MEASURED_REVIEW,
        propertyId: OVERDUE_PROPERTY,
        eligibility: 'historical_onboarding',
        startAt: null,
        dueAt: null,
      })
      await seedReviewTarget({
        itemId: COMPLETED_ITEM,
        reviewId: COMPLETED_REVIEW,
        propertyId: OVERDUE_PROPERTY,
        eligibility: 'measured',
        startAt: STARTED_AT,
        dueAt: OVERDUE_AT,
        completionAt: COMPLETED_AT,
        result: 'on_time',
        stopReason: 'confirmed_on_google',
      })

      const execute = vi.spyOn(db, 'execute')
      try {
        const counts = await createResponseTargetStore(
          db,
        ).getGoogleReviewTargetCountsByProperty({
          organizationId: ORG,
          propertyIds: [OVERDUE_PROPERTY, ACTIVE_PROPERTY, EMPTY_PROPERTY],
          now: NOW,
        })

        expect(execute).toHaveBeenCalledTimes(1)
        expect(counts).toEqual(
          new Map([
            [OVERDUE_PROPERTY, { activeCount: 1, overdueCount: 1 }],
            [ACTIVE_PROPERTY, { activeCount: 1, overdueCount: 0 }],
            [EMPTY_PROPERTY, { activeCount: 0, overdueCount: 0 }],
          ]),
        )
      } finally {
        execute.mockRestore()
      }
    })
  },
)
