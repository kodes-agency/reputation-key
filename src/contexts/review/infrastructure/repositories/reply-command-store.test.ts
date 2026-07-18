// BQC-3.3 — reply command store integration tests (real Postgres).
//
// Crash-boundary proof on the real database:
//   1. Outbox insert failure (unregistered event type → toOutboxEvent throws)
//      rolls back the state write — no state/outbox split is observable.
//   2. Happy path commits state row AND outbox row with the same eventId.
//   3. purgeExpiredReview removes the review and records review.expired
//      atomically.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import {
  organizationId,
  propertyId,
  reviewId,
  replyId,
  userId,
} from '#/shared/domain/ids'
import type { Reply, Review } from '../../domain/types'
import {
  reviewExpired,
  reviewReplyPublished,
  reviewReplySubmitted,
} from '../../domain/events'
import { createReviewRepository } from './review.repository'
import { createReplyRepository } from './reply.repository'
import { createAtomicReplyCommandStore } from '../reply-command-store'

const ORG_A = organizationId('org-reply-cmd-aaaa-1111111111111111')
const PROP_A = propertyId('2b000000-0000-0000-0000-000000000001')
const REVIEW_A = reviewId('2b000000-0000-0000-0000-000000000010')
const REPLY_A = replyId('2b000000-0000-0000-0000-000000000020')
const USER_A = userId('user-reply-cmd-aaaa-1111111111')

const NOW = new Date('2025-06-01T12:00:00.000Z')

let pool: Pool

async function seedOrgAndProperty(p: Pool) {
  const slug = 't-' + ORG_A.replace(/-/g, '').slice(-12)
  await p.query(`DELETE FROM organization WHERE slug = $1 AND id <> $2`, [slug, ORG_A])
  await p.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name`,
    [ORG_A, `Test Org ${slug}`, slug],
  )
  await p.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROP_A, ORG_A, 'Reply Cmd Property', 'reply-cmd-prop', 'UTC'],
  )
}

async function truncateAll(p: Pool) {
  await p.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG_A])
  await p.query('DELETE FROM replies WHERE organization_id = $1', [ORG_A])
  await p.query('DELETE FROM reviews WHERE organization_id = $1', [ORG_A])
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    id: REVIEW_A,
    organizationId: ORG_A,
    propertyId: PROP_A,
    platform: 'google',
    externalId: 'ext-reply-cmd-1',
    externalLocationId: 'accounts/111/locations/222',
    googleConnectionId: null,
    reviewerName: 'Jane Doe',
    reviewerProfilePhotoUrl: null,
    rating: 5,
    text: 'Great place!',
    languageCode: 'en',
    reviewedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 25 * 24 * 60 * 60 * 1000),
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: NOW,
    sourceUpdatedAt: null,
    firstFetchedAt: NOW,
    lastFetchedAt: NOW,
    contentExpiresAt: null,
    contentHash: null,
    sourceSeenGeneration: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeReply(overrides: Partial<Reply> = {}): Reply {
  return {
    id: REPLY_A,
    reviewId: REVIEW_A,
    organizationId: ORG_A,
    text: 'Thank you for the kind words!',
    status: 'draft',
    source: 'internal',
    createdBy: USER_A,
    approvedBy: null,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    submittedAt: null,
    approvedAt: null,
    publishedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

const silentEvents: EventBus = {
  on: () => {},
  emit: async () => {},
  clear: () => {},
}

/** Same shape as a real reply event but with a type no schema is registered for. */
function unregisteredEvent(base: DomainEvent): DomainEvent {
  return { ...base, _tag: 'review.reply.ghost' } as unknown as DomainEvent
}

beforeAll(async () => {
  const env = getEnv()
  pool = new Pool({ connectionString: env.DATABASE_URL, max: 5 })
  const client = await pool.connect()
  client.release()
  clearEventSchemas()
  registerAllEventSchemas()
})

afterAll(async () => {
  clearEventSchemas()
  await pool.end()
})

beforeEach(async () => {
  await truncateAll(pool)
  await seedOrgAndProperty(pool)
})

describe.sequential('replyCommandStore (integration)', () => {
  it('rolls back the state write when the outbox insert fails (no state/outbox split)', async () => {
    const db = getDb()
    const reviewRepo = createReviewRepository(db)
    const replyRepo = createReplyRepository(db)
    const store = createAtomicReplyCommandStore(db, silentEvents)

    await reviewRepo.upsert(makeReview())
    await replyRepo.upsert(makeReply({ status: 'draft' }))

    const event = unregisteredEvent(
      reviewReplySubmitted({
        replyId: REPLY_A,
        reviewId: REVIEW_A,
        propertyId: PROP_A,
        organizationId: ORG_A,
        userId: USER_A,
        occurredAt: NOW,
      }),
    )

    await expect(
      store.submitReply(
        makeReply({ status: 'draft' }),
        { status: 'pending_approval', submittedAt: NOW },
        event as never,
        NOW,
      ),
    ).rejects.toThrow()

    // Rollback: the reply status is unchanged AND no outbox row exists.
    const persisted = await replyRepo.findById(REPLY_A, ORG_A)
    expect(persisted?.status).toBe('draft')
    const outbox = await pool.query(
      'SELECT id FROM outbox_events WHERE organization_id = $1',
      [ORG_A],
    )
    expect(outbox.rows).toHaveLength(0)
  })

  it('rolls back a mirror upsert when its outbox insert fails (reply row absent)', async () => {
    const db = getDb()
    const reviewRepo = createReviewRepository(db)
    const store = createAtomicReplyCommandStore(db, silentEvents)

    await reviewRepo.upsert(makeReview())

    const mirrored = makeReply({
      status: 'published',
      source: 'google_sync',
      createdBy: null,
      publishedAt: NOW,
    })
    const { createdAt: _c, updatedAt: _u, ...replyInput } = mirrored

    const event = unregisteredEvent(
      reviewReplyPublished({
        source: 'import',
        authorId: null,
        userId: null,
        replyId: REPLY_A,
        reviewId: REVIEW_A,
        organizationId: ORG_A,
        propertyId: PROP_A,
        occurredAt: NOW,
      }),
    )

    await expect(
      store.mirrorSyncedReply({
        reply: replyInput,
        reviewId: REVIEW_A,
        organizationId: ORG_A,
        event: event as never,
        now: NOW,
      }),
    ).rejects.toThrow()

    const rows = await pool.query('SELECT id FROM replies WHERE organization_id = $1', [
      ORG_A,
    ])
    expect(rows.rows).toHaveLength(0)
    const outbox = await pool.query(
      'SELECT id FROM outbox_events WHERE organization_id = $1',
      [ORG_A],
    )
    expect(outbox.rows).toHaveLength(0)
  })

  it('commits state row and outbox row with identical eventId (happy path)', async () => {
    const db = getDb()
    const reviewRepo = createReviewRepository(db)
    const replyRepo = createReplyRepository(db)
    const store = createAtomicReplyCommandStore(db, silentEvents)

    await reviewRepo.upsert(makeReview())
    await replyRepo.upsert(makeReply({ status: 'draft' }))

    const event = reviewReplySubmitted({
      replyId: REPLY_A,
      reviewId: REVIEW_A,
      propertyId: PROP_A,
      organizationId: ORG_A,
      userId: USER_A,
      occurredAt: NOW,
    })

    const saved = await store.submitReply(
      makeReply({ status: 'draft' }),
      { status: 'pending_approval', submittedAt: NOW },
      event,
      NOW,
    )

    expect(saved?.status).toBe('pending_approval')
    const persisted = await replyRepo.findById(REPLY_A, ORG_A)
    expect(persisted?.status).toBe('pending_approval')

    const outbox = await pool.query(
      `SELECT id, event_type, payload FROM outbox_events WHERE organization_id = $1`,
      [ORG_A],
    )
    expect(outbox.rows).toHaveLength(1)
    expect(outbox.rows[0].id).toBe(event.eventId)
    expect(outbox.rows[0].event_type).toBe('review.reply.submitted')
    // Identifier-only payload on the real pipeline.
    expect(Object.keys(outbox.rows[0].payload).sort()).toEqual([
      'occurredAt',
      'organizationId',
      'propertyId',
      'replyId',
      'reviewId',
      'source',
      'userId',
    ])
  })

  it('purgeExpiredReview deletes the review and records review.expired atomically', async () => {
    const db = getDb()
    const reviewRepo = createReviewRepository(db)
    const store = createAtomicReplyCommandStore(db, silentEvents)

    await reviewRepo.upsert(makeReview())

    const event = reviewExpired({
      reviewId: REVIEW_A,
      propertyId: PROP_A,
      organizationId: ORG_A,
      occurredAt: NOW,
    })

    await store.purgeExpiredReview(REVIEW_A, event)

    const found = await reviewRepo.findById(REVIEW_A, ORG_A)
    expect(found).toBeNull()
    const outbox = await pool.query(
      `SELECT id, event_type FROM outbox_events WHERE organization_id = $1`,
      [ORG_A],
    )
    expect(outbox.rows).toHaveLength(1)
    expect(outbox.rows[0].id).toBe(event.eventId)
    expect(outbox.rows[0].event_type).toBe('review.expired')
  })
})
