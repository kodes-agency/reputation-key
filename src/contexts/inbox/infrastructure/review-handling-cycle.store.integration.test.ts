import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import type { EventBus } from '#/shared/events/event-bus'
import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem } from '../domain/types'
import { isInboxError } from '../domain/errors'
import { createAtomicInboxCommandStore } from './inbox-command-store'
import { createReviewHandlingCycleStore } from './review-handling-cycle.store'

const ORG_ID = organizationId('org-inbox-cycles-0000000000000001')
const PROPERTY_ID = propertyId('4f000000-0000-0000-0000-000000000001')
const REVIEW_ID = reviewId('4f000000-0000-0000-0000-000000000002')
const ITEM_ID = inboxItemId('4f000000-0000-0000-0000-000000000003')
const USER_ID = userId('user-inbox-cycles-000000000000001')
const OPENED_AT = new Date('2026-08-26T10:00:00.000Z')
const db = getDb()
let pool: Pool

const silentEvents: EventBus = {
  on: () => {},
  emit: async () => {},
  clear: () => {},
}

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
  createdAt: OPENED_AT,
  updatedAt: OPENED_AT,
})

async function clean(): Promise<void> {
  await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORG_ID])
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG_ID])
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG_ID])
  await pool.query('DELETE FROM organization WHERE id = $1', [ORG_ID])
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
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id,
       external_location_id, rating, reviewed_at, expires_at,
       source_epoch, source_revision, source_observation_sequence,
       analysis_sequence, ai_source_byte_length, ai_source_digest,
       source_content_state, created_at, updated_at
     ) VALUES (
       $1, $2, $3, 'google', $4, $5, 4, $6, $7,
       0, 1, 0, 1, 1, $8, 'active', $6, $6
     )`,
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
  await createAtomicInboxCommandStore(db, silentEvents).createItem(makeItem(), null, {
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

async function advanceReviewTo(revision: number): Promise<void> {
  await insertMaterialRevision(revision)
  await pool.query(
    `UPDATE reviews SET source_revision = $1, updated_at = $2
     WHERE id = $3 AND organization_id = $4`,
    [revision, OPENED_AT, REVIEW_ID, ORG_ID],
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
    await expect(store.listCycles(ITEM_ID, ORG_ID)).resolves.toEqual([
      expect.objectContaining({
        cycleNumber: 1,
        materialReviewRevision: 1,
        openedReason: 'review_observed',
        supersedesCycleNumber: null,
      }),
    ])

    await expect(
      pool.query(
        `UPDATE inbox_handling_cycles SET material_review_revision = 2
         WHERE inbox_item_id = $1 AND cycle_number = 1`,
        [ITEM_ID],
      ),
    ).rejects.toThrow('immutable')
    await expect(store.listCycles(ITEM_ID, ORG_ID)).resolves.toEqual([
      expect.objectContaining({
        cycleNumber: 1,
        materialReviewRevision: 1,
        openedReason: 'review_observed',
      }),
    ])
  })

  it('appends a later material-revision cycle and preserves cycle one verbatim', async () => {
    const store = createReviewHandlingCycleStore(db)
    const [cycleOne] = await store.listCycles(ITEM_ID, ORG_ID)
    await advanceReviewTo(2)

    const result = await store.startNext({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      expected: { cycleNumber: 1, materialReviewRevision: 1, stateRevision: 1 },
      materialReviewRevision: 2,
      openedReason: 'material_revision_changed',
      openedBy: null,
      openedAt: OPENED_AT,
    })

    expect(result.head).toMatchObject({
      currentCycleNumber: 2,
      currentMaterialReviewRevision: 2,
      stateRevision: 2,
      status: 'open',
    })
    const cycles = await store.listCycles(ITEM_ID, ORG_ID)
    expect(cycles).toHaveLength(2)
    expect(cycles[0]).toEqual(cycleOne)
    expect(cycles[1]).toMatchObject({
      cycleNumber: 2,
      materialReviewRevision: 2,
      openedReason: 'material_revision_changed',
      supersedesCycleNumber: 1,
    })
  })

  it('lets exactly one concurrent writer advance the expected head', async () => {
    const store = createReviewHandlingCycleStore(db)
    await advanceReviewTo(2)
    const command = {
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      expected: {
        cycleNumber: 1,
        materialReviewRevision: 1,
        stateRevision: 1,
      },
      materialReviewRevision: 2,
      openedReason: 'material_revision_changed' as const,
      openedBy: null,
      openedAt: OPENED_AT,
    }

    const outcomes = await Promise.allSettled([
      store.startNext(command),
      store.startNext(command),
    ])

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected')
    expect(rejected?.status).toBe('rejected')
    if (rejected?.status !== 'rejected') return
    expect(isInboxError(rejected.reason)).toBe(true)
    if (!isInboxError(rejected.reason)) return
    expect(rejected.reason).toMatchObject({
      code: 'revision_conflict',
      context: {
        current: {
          cycleNumber: 2,
          materialReviewRevision: 2,
          stateRevision: 2,
        },
      },
    })
    await expect(store.listCycles(ITEM_ID, ORG_ID)).resolves.toHaveLength(2)
  })

  it('permits a same-revision manual reopen but rejects a non-current Review revision', async () => {
    const store = createReviewHandlingCycleStore(db)
    await advanceReviewTo(2)
    await store.startNext({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      expected: { cycleNumber: 1, materialReviewRevision: 1, stateRevision: 1 },
      materialReviewRevision: 2,
      openedReason: 'material_revision_changed',
      openedBy: null,
      openedAt: OPENED_AT,
    })

    const reopened = await store.startNext({
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      expected: { cycleNumber: 2, materialReviewRevision: 2, stateRevision: 2 },
      materialReviewRevision: 2,
      openedReason: 'manual_reopen',
      openedBy: USER_ID,
      openedAt: OPENED_AT,
    })
    expect(reopened.cycle).toMatchObject({
      cycleNumber: 3,
      materialReviewRevision: 2,
      openedBy: USER_ID,
    })

    await insertMaterialRevision(3)
    await expect(
      store.startNext({
        inboxItemId: ITEM_ID,
        organizationId: ORG_ID,
        expected: { cycleNumber: 3, materialReviewRevision: 2, stateRevision: 3 },
        materialReviewRevision: 3,
        openedReason: 'material_revision_changed',
        openedBy: null,
        openedAt: OPENED_AT,
      }),
    ).rejects.toMatchObject({ code: 'revision_conflict' })
    await expect(store.listCycles(ITEM_ID, ORG_ID)).resolves.toHaveLength(3)
  })
})
