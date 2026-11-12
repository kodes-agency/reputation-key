import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb, type Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'

import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem } from '../domain/types'
import {
  createAtomicInboxCommandStore as createProductionInboxCommandStore,
  type InboxCommandAuthority,
} from './inbox-command-store'
import { createReviewHandlingCycleStore } from './review-handling-cycle.store'

const ORG_ID = organizationId('org-inbox-cycles-0000000000000001')
const PROPERTY_ID = propertyId('4f000000-0000-0000-0000-000000000001')
const REVIEW_ID = reviewId('4f000000-0000-0000-0000-000000000002')
const ITEM_ID = inboxItemId('4f000000-0000-0000-0000-000000000003')
const USER_ID = userId('user-inbox-cycles-000000000000001')
const OPENED_AT = new Date('2026-08-26T10:00:00.000Z')
const db = getDb()
let pool: Pool

const allowAllCommandAuthority: InboxCommandAuthority = async () => ({
  allowed: true,
})

const createAtomicInboxCommandStore = (database: Database) =>
  createProductionInboxCommandStore(database, allowAllCommandAuthority, () => OPENED_AT)

const makeItem = (): InboxItem => ({
  id: ITEM_ID,
  organizationId: ORG_ID,
  propertyId: PROPERTY_ID,
  sourceType: 'review',
  sourceId: REVIEW_ID,
  status: 'open',
  isEscalated: false,
  escalatedAt: null,
  escalatedBy: null,
  escalationResolvedAt: null,
  escalationResolvedBy: null,
  rating: null,
  sourceDate: OPENED_AT,
  platform: 'google',
  snippet: null,
  reviewerName: null,
  propertyName: null,
  assignedTo: null,
  closedAt: null,
  firstReplySubmittedAt: null,
  firstReplyPublishedAt: null,
  commandRevision: 1,
  createdAt: OPENED_AT,
  updatedAt: OPENED_AT,
})

async function clean(): Promise<void> {
  await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORG_ID])
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG_ID])
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG_ID])
  await deleteTestOrganizations(pool, [ORG_ID])
}

async function seedScope(): Promise<void> {
  const slug = 'inbox-cycles-0001'
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Inbox Cycle Test', $2, NOW())`,
    [ORG_ID, slug],
  )
  await pool.query(
    `INSERT INTO properties (
       id, organization_id, name, slug, timezone, source_epoch, created_at, updated_at
     ) VALUES ($1, $2, 'Cycle Property', 'cycle-property', 'UTC', 0, NOW(), NOW())`,
    [PROPERTY_ID, ORG_ID],
  )
  await pool.query(
    `WITH identity AS (
       INSERT INTO reviews (
         id, organization_id, property_id, platform, external_id,
         external_location_id, expires_at, first_fetched_at,
         source_epoch, source_revision, source_observation_sequence,
         analysis_sequence, source_content_state, created_at, updated_at
       ) VALUES (
         $1, $2, $3, 'google', $4, $5, $7, $6,
         0, 1, 0, 1, 'active', $6, $6
       )
       RETURNING id
     ) INSERT INTO review_source_contents (
       review_id, organization_id, property_id, platform, external_id,
       external_location_id, rating, reviewed_at, content_expires_at,
       first_fetched_at, last_fetched_at, source_epoch, source_revision,
       ai_source_byte_length, ai_source_digest
     ) SELECT id, $2, $3, 'google', $4, $5, 4, $6, $7, $6, $6, 0, 1, 1, $8
       FROM identity`,
    [
      REVIEW_ID,
      ORG_ID,
      PROPERTY_ID,
      `external-${REVIEW_ID}`,
      'locations/inbox-cycle-test',
      OPENED_AT,
      new Date('2027-08-26T10:00:00.000Z'),
      '0'.repeat(64),
    ],
  )
  await insertMaterialRevision(1)
  await createAtomicInboxCommandStore(db).createItem(makeItem(), null, {
    materialReviewRevision: 1,
  })
}

async function insertMaterialRevision(revision: number): Promise<void> {
  const digest = String(revision).repeat(64).slice(0, 64)
  await pool.query(
    `INSERT INTO material_review_revisions (
       review_id, revision, organization_id, property_id, source_epoch,
       normalization_version, source_digest, normalized_digest, rating,
       normalized_text, content_state, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, 0, 'review-material-v1', $5, $5, 4,
       $6, 'active', $7, $7
     )`,
    [REVIEW_ID, revision, ORG_ID, PROPERTY_ID, digest, `text-${revision}`, OPENED_AT],
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
  await seedScope()
})

describe.sequential('Review Handling Cycle store (PostgreSQL)', () => {
  it('creates cycle one atomically with a newly observed Review Inbox item', async () => {
    const store = createReviewHandlingCycleStore(db)

    await expect(store.findHead(ITEM_ID, ORG_ID)).resolves.toMatchObject({
      currentCycleNumber: 1,
      currentMaterialReviewRevision: 1,
      stateRevision: 1,
      status: 'open',
      reviewId: REVIEW_ID,
    })
    const cycles = await pool.query(
      `SELECT cycle_number, material_review_revision, opened_reason,
              supersedes_cycle_number
       FROM inbox_handling_cycles WHERE inbox_item_id = $1`,
      [ITEM_ID],
    )
    expect(cycles.rows).toEqual([
      {
        cycle_number: '1',
        material_review_revision: '1',
        opened_reason: 'review_observed',
        supersedes_cycle_number: null,
      },
    ])
  })

  it('rejects manual reopen rows without a governed reason at the database fence', async () => {
    const insertManualCycle = (reason: string | null, explanation: string | null) =>
      pool.query(
        `INSERT INTO inbox_handling_cycles (
           inbox_item_id, cycle_number, organization_id, property_id,
           source_type, source_id, source_revision, review_id,
           material_review_revision, opened_reason, manual_reopen_reason,
           manual_reopen_explanation, supersedes_cycle_number, opened_by,
           opened_at, created_at
         ) VALUES (
           $1, 2, $2, $3, 'review', $4, 1, $4, 1,
           'manual_reopen', $5, $6, 1, $7, $8, $8
         )`,
        [
          ITEM_ID,
          ORG_ID,
          PROPERTY_ID,
          REVIEW_ID,
          reason,
          explanation,
          USER_ID,
          OPENED_AT,
        ],
      )

    await expect(insertManualCycle(null, null)).rejects.toThrow(
      'inbox_handling_cycles_manual_reopen_valid',
    )
    await expect(insertManualCycle('other', '   ')).rejects.toThrow(
      'inbox_handling_cycles_manual_reopen_valid',
    )
  })
})
