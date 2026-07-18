// BQC-3.8 — publication state machine integration tests (real Postgres).
//
// Migration 0015 (drizzle/0015_publication-state.sql) persists the durable
// publication overlay on replies. These tests prove on the real database:
//   1. The 0015 columns exist and the CHECK constraints reject states/classes
//      outside the domain unions.
//   2. cancelPublications is atomic: state write + one fact per row in ONE
//      batch transaction — a forced outbox failure rolls the WHOLE batch
//      back (no cancelled row, no fact).
//   3. An ambiguous row written by the store (markPublicationAmbiguous) is
//      findable by the reconcile sweep query (findAmbiguousPublicationBatch)
//      exactly when reconcile_due_at has passed — future-due rows are not.
//   4. Purge-deleted rows are tolerated by cancellation (guarded update
//      matches nothing: no count, no fact).

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
  reviewReplyPublicationCancelled,
  reviewReplyPublishFailed,
  type ReviewReplyPublicationCancelled,
} from '../../domain/events'
import { AMBIGUOUS_RECONCILE_DELAY_MS } from '../../domain/reply-publication-workflow'
import { createReviewRepository } from './review.repository'
import { createReplyRepository } from './reply.repository'
import { createAtomicReplyCommandStore } from '../reply-command-store'

const ORG_A = organizationId('org-pub-state-bbbb-2222222222222222')
const PROP_A = propertyId('3c000000-0000-0000-0000-000000000001')
const REVIEW_A = reviewId('3c000000-0000-0000-0000-000000000010')
const REPLY_A = replyId('3c000000-0000-0000-0000-000000000020')
const REPLY_B = replyId('3c000000-0000-0000-0000-000000000021')
const REPLY_C = replyId('3c000000-0000-0000-0000-000000000022')
const USER_A = userId('user-pub-state-bbbb-2222222222')

const NOW = new Date('2026-07-17T12:00:00.000Z')

let pool: Pool

const silentEvents: EventBus = {
  on: () => {},
  emit: async () => {},
  clear: () => {},
}

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
    [PROP_A, ORG_A, 'Publication State Property', 'pub-state-prop', 'UTC'],
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
    externalId: 'ext-pub-state-1',
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
    status: 'approved',
    source: 'internal',
    createdBy: USER_A,
    approvedBy: USER_A,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    submittedAt: NOW,
    approvedAt: NOW,
    publishedAt: null,
    publicationState: 'authorized',
    publicationAttempts: 0,
    publicationLastErrorClass: null,
    reconcileDueAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

const cancelledEvent = (id: typeof REPLY_A, cause: 'disconnect' | 'policy') =>
  reviewReplyPublicationCancelled({
    replyId: id,
    reviewId: REVIEW_A,
    propertyId: PROP_A,
    organizationId: ORG_A,
    cause,
    occurredAt: NOW,
  })

/** Same shape as a real cancellation event but with an unregistered tag. */
function ghostEvent(base: DomainEvent): ReviewReplyPublicationCancelled {
  return {
    ...base,
    _tag: 'review.reply.ghost',
  } as unknown as ReviewReplyPublicationCancelled
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

describe.sequential('publication state machine (integration, migration 0015)', () => {
  it('the 0015 columns exist on replies', async () => {
    const result = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'replies'
         AND column_name IN (
           'publication_state', 'publication_attempts',
           'publication_last_error_class', 'reconcile_due_at'
         )`,
    )
    expect(result.rows.map((r) => r.column_name).sort()).toEqual([
      'publication_attempts',
      'publication_last_error_class',
      'publication_state',
      'reconcile_due_at',
    ])
  })

  it('the CHECK constraint rejects a publication_state outside the domain union', async () => {
    const db = getDb()
    await createReviewRepository(db).upsert(makeReview())
    await createReplyRepository(db).upsert(makeReply())

    await expect(
      pool.query(`UPDATE replies SET publication_state = 'teleporting' WHERE id = $1`, [
        REPLY_A,
      ]),
    ).rejects.toThrow(/replies_publication_state_check/)

    await expect(
      pool.query(
        `UPDATE replies SET publication_last_error_class = 'oops' WHERE id = $1`,
        [REPLY_A],
      ),
    ).rejects.toThrow(/replies_publication_last_error_class_check/)
  })

  it('cancelPublications commits state + one fact per row in the batch tx; published rows stay untouched', async () => {
    const db = getDb()
    const reviewRepo = createReviewRepository(db)
    const replyRepo = createReplyRepository(db)
    const store = createAtomicReplyCommandStore(db, silentEvents)

    await reviewRepo.upsert(makeReview())
    // One review, three replies is impossible (unique review+source+org) —
    // seed three reviews with one reply each instead.
    await replyRepo.upsert(makeReply({ publicationState: 'authorized' }))
    await reviewRepo.upsert(
      makeReview({
        id: reviewId('3c000000-0000-0000-0000-000000000011'),
        externalId: 'ext-pub-state-2',
      }),
    )
    await replyRepo.upsert(
      makeReply({
        id: REPLY_B,
        reviewId: reviewId('3c000000-0000-0000-0000-000000000011'),
        publicationState: 'sending',
        publicationAttempts: 1,
      }),
    )
    await reviewRepo.upsert(
      makeReview({
        id: reviewId('3c000000-0000-0000-0000-000000000012'),
        externalId: 'ext-pub-state-3',
      }),
    )
    await replyRepo.upsert(
      makeReply({
        id: REPLY_C,
        reviewId: reviewId('3c000000-0000-0000-0000-000000000012'),
        status: 'published',
        publicationState: 'published',
        publishedAt: NOW,
      }),
    )

    const eventA = cancelledEvent(REPLY_A, 'disconnect')
    const eventB = cancelledEvent(REPLY_B, 'disconnect')
    const count = await store.cancelPublications([
      { reply: makeReply({ publicationState: 'authorized' }), event: eventA, now: NOW },
      {
        reply: makeReply({
          id: REPLY_B,
          reviewId: reviewId('3c000000-0000-0000-0000-000000000011'),
          publicationState: 'sending',
          publicationAttempts: 1,
        }),
        event: eventB,
        now: NOW,
      },
      {
        // Already published — skipped by the domain pre-check, no fact.
        reply: makeReply({
          id: REPLY_C,
          reviewId: reviewId('3c000000-0000-0000-0000-000000000012'),
          status: 'published',
          publicationState: 'published',
          publishedAt: NOW,
        }),
        event: cancelledEvent(REPLY_C, 'disconnect'),
        now: NOW,
      },
    ])

    expect(count).toBe(2)

    const rows = await pool.query(
      `SELECT id, status, publication_state FROM replies WHERE organization_id = $1 ORDER BY id`,
      [ORG_A],
    )
    const byId = new Map(rows.rows.map((r) => [r.id, r]))
    expect(byId.get(REPLY_A as string)).toMatchObject({
      status: 'draft',
      publication_state: 'cancelled',
    })
    expect(byId.get(REPLY_B as string)).toMatchObject({
      status: 'draft',
      publication_state: 'cancelled',
    })
    // The published row is untouched.
    expect(byId.get(REPLY_C as string)).toMatchObject({
      status: 'published',
      publication_state: 'published',
    })

    const outbox = await pool.query(
      `SELECT id, event_type, payload FROM outbox_events
       WHERE organization_id = $1 ORDER BY created_at, id`,
      [ORG_A],
    )
    expect(outbox.rows).toHaveLength(2)
    expect(outbox.rows.map((r) => r.id).sort()).toEqual(
      [eventA.eventId, eventB.eventId].sort(),
    )
    for (const row of outbox.rows) {
      expect(row.event_type).toBe('review.reply.publication_cancelled')
      expect(row.payload.cause).toBe('disconnect')
    }
  })

  it('cancelPublications rolls the WHOLE batch back when one fact fails (no state/fact split)', async () => {
    const db = getDb()
    const reviewRepo = createReviewRepository(db)
    const replyRepo = createReplyRepository(db)
    const store = createAtomicReplyCommandStore(db, silentEvents)

    await reviewRepo.upsert(makeReview())
    await replyRepo.upsert(makeReply({ publicationState: 'authorized' }))
    await reviewRepo.upsert(
      makeReview({
        id: reviewId('3c000000-0000-0000-0000-000000000011'),
        externalId: 'ext-pub-state-2',
      }),
    )
    await replyRepo.upsert(
      makeReply({
        id: REPLY_B,
        reviewId: reviewId('3c000000-0000-0000-0000-000000000011'),
        publicationState: 'sending',
        publicationAttempts: 1,
      }),
    )

    await expect(
      store.cancelPublications([
        // First command would succeed on its own…
        {
          reply: makeReply({ publicationState: 'authorized' }),
          event: cancelledEvent(REPLY_A, 'disconnect'),
          now: NOW,
        },
        // …but the second fact is unregistered, so the batch tx rolls back.
        {
          reply: makeReply({
            id: REPLY_B,
            reviewId: reviewId('3c000000-0000-0000-0000-000000000011'),
            publicationState: 'sending',
            publicationAttempts: 1,
          }),
          event: ghostEvent(cancelledEvent(REPLY_B, 'disconnect')),
          now: NOW,
        },
      ]),
    ).rejects.toThrow()

    // Rollback: BOTH replies keep their pre-batch state; no outbox row exists.
    const rows = await pool.query(
      `SELECT id, status, publication_state FROM replies WHERE organization_id = $1 ORDER BY id`,
      [ORG_A],
    )
    const byId = new Map(rows.rows.map((r) => [r.id, r]))
    expect(byId.get(REPLY_A as string)).toMatchObject({
      status: 'approved',
      publication_state: 'authorized',
    })
    expect(byId.get(REPLY_B as string)).toMatchObject({
      status: 'approved',
      publication_state: 'sending',
    })
    const outbox = await pool.query(
      'SELECT id FROM outbox_events WHERE organization_id = $1',
      [ORG_A],
    )
    expect(outbox.rows).toHaveLength(0)
  })

  it('an ambiguous row written by the store is findable by the sweep query once due', async () => {
    const db = getDb()
    const reviewRepo = createReviewRepository(db)
    const replyRepo = createReplyRepository(db)
    const store = createAtomicReplyCommandStore(db, silentEvents)

    await reviewRepo.upsert(makeReview())
    await replyRepo.upsert(makeReply({ publicationState: 'authorized' }))

    // Claim, then fail ambiguous on the final attempt — the store persists
    // publication_state='ambiguous' + reconcile_due_at = NOW + 15min.
    const claimed = await store.markPublicationSending(
      makeReply({ publicationState: 'authorized' }),
      NOW,
    )
    expect(claimed?.publicationState).toBe('sending')
    expect(claimed?.publicationAttempts).toBe(1)

    const marked = await store.markPublicationAmbiguous(
      claimed!,
      reviewReplyPublishFailed({
        replyId: REPLY_A,
        reviewId: REVIEW_A,
        propertyId: PROP_A,
        organizationId: ORG_A,
        authorId: USER_A,
        occurredAt: NOW,
      }),
      NOW,
    )
    expect(marked?.status).toBe('publish_failed')
    expect(marked?.publicationState).toBe('ambiguous')
    expect(marked?.publicationLastErrorClass).toBe('ambiguous')
    expect(marked?.reconcileDueAt?.getTime()).toBe(
      NOW.getTime() + AMBIGUOUS_RECONCILE_DELAY_MS,
    )

    // Not yet due → the sweep query skips the row.
    const notYetDue = await replyRepo.findAmbiguousPublicationBatch(
      new Date(NOW.getTime() + AMBIGUOUS_RECONCILE_DELAY_MS - 60 * 1000),
      null,
      500,
    )
    expect(notYetDue).toHaveLength(0)

    // Due → the sweep query finds exactly this row.
    const due = await replyRepo.findAmbiguousPublicationBatch(
      new Date(NOW.getTime() + AMBIGUOUS_RECONCILE_DELAY_MS),
      null,
      500,
    )
    expect(due.map((r) => r.id)).toEqual([REPLY_A])

    // The publish_failed fact committed with the state write.
    const outbox = await pool.query(
      `SELECT event_type FROM outbox_events WHERE organization_id = $1`,
      [ORG_A],
    )
    expect(outbox.rows.map((r) => r.event_type)).toEqual(['review.reply.publish_failed'])
  })

  it('cancelPublications tolerates purge-deleted rows (guarded update matches nothing)', async () => {
    const db = getDb()
    const store = createAtomicReplyCommandStore(db, silentEvents)

    // No rows seeded at all — the disconnect purge already deleted them.
    const count = await store.cancelPublications([
      {
        reply: makeReply({ publicationState: 'sending', publicationAttempts: 1 }),
        event: cancelledEvent(REPLY_A, 'disconnect'),
        now: NOW,
      },
    ])

    expect(count).toBe(0)
    const outbox = await pool.query(
      'SELECT id FROM outbox_events WHERE organization_id = $1',
      [ORG_A],
    )
    expect(outbox.rows).toHaveLength(0)
  })

  it('a claimed row cannot be re-claimed after cancellation (race guard on real SQL)', async () => {
    const db = getDb()
    const reviewRepo = createReviewRepository(db)
    const replyRepo = createReplyRepository(db)
    const store = createAtomicReplyCommandStore(db, silentEvents)

    await reviewRepo.upsert(makeReview())
    await replyRepo.upsert(makeReply({ publicationState: 'authorized' }))

    // Disconnect cancels the publication…
    const count = await store.cancelPublications([
      {
        reply: makeReply({ publicationState: 'authorized' }),
        event: cancelledEvent(REPLY_A, 'disconnect'),
        now: NOW,
      },
    ])
    expect(count).toBe(1)

    // …and a racing worker's claim (issued against the pre-cancel read) misses.
    const claim = await store.markPublicationSending(
      makeReply({ publicationState: 'authorized' }),
      NOW,
    )
    expect(claim).toBeNull()

    const persisted = await replyRepo.findById(REPLY_A, ORG_A)
    expect(persisted?.status).toBe('draft')
    expect(persisted?.publicationState).toBe('cancelled')
  })
})
