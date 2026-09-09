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
//      findable by the reconcile sweep query
//      (findDuePublicationReconciliationBatch)
//      exactly when reconcile_due_at has passed — future-due rows are not.
//   4. Purge-deleted rows are tolerated by cancellation (guarded update
//      matches nothing: no count, no fact).

import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
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
  reviewReplyPublicationRequested,
  reviewReplyPublishFailed,
  type ReviewReplyPublicationCancelled,
} from '../../domain/events'
import {
  AMBIGUOUS_RECONCILE_DELAY_MS,
  PROVIDER_OBSERVATION_RECONCILE_DELAY_MS,
  PUBLICATION_RECOVERY_RECONCILE_DELAY_MS,
} from '../../domain/reply-publication-workflow'
import { createReviewRepository } from './review.repository'
import { createReplyRepository } from './reply.repository'
import { createAtomicReplyCommandStore } from '../reply-command-store'
import { createGoogleReplyObservationStore } from '../google-reply-observation-store'
import type { PublicationAttemptStart } from '../../application/ports/reply-command-store.port'

const ORG_A = organizationId('org-pub-state-bbbb-2222222222222222')
const PROP_A = propertyId('3c000000-0000-0000-0000-000000000001')
const REVIEW_A = reviewId('3c000000-0000-0000-0000-000000000010')
const REPLY_A = replyId('3c000000-0000-0000-0000-000000000020')
const REPLY_B = replyId('3c000000-0000-0000-0000-000000000021')
const REPLY_C = replyId('3c000000-0000-0000-0000-000000000022')
const USER_A = userId('user-pub-state-bbbb-2222222222')

const NOW = new Date('2026-07-17T12:00:00.000Z')

let pool: Pool

async function seedOrgAndProperty(p: Pool) {
  const slug = 't-' + ORG_A.replace(/-/g, '').slice(-12)
  const conflictingOrganizations = await p.query<{ id: string }>(
    `SELECT id FROM organization WHERE slug = $1 AND id <> $2`,
    [slug, ORG_A],
  )
  await deleteTestOrganizations(
    p,
    conflictingOrganizations.rows.map(({ id }) => id),
  )
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
  await p.query('DELETE FROM google_reply_observation_heads WHERE organization_id = $1', [
    ORG_A,
  ])
  await p.query('DELETE FROM google_reply_observations WHERE organization_id = $1', [
    ORG_A,
  ])
  await p.query('DELETE FROM reply_publication_attempts WHERE organization_id = $1', [
    ORG_A,
  ])
  await p.query(
    'DELETE FROM reply_publication_authorizations WHERE organization_id = $1',
    [ORG_A],
  )
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
    externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
    googleConnectionId: null,
    reviewerName: 'Jane Doe',
    reviewerProfilePhotoUrl: null,
    rating: 5,
    text: 'Great place!',
    translatedText: null,
    languageCode: 'en',
    reviewedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 25 * 24 * 60 * 60 * 1000),
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: NOW,
    sourceUpdatedAt: null,
    firstFetchedAt: NOW,
    lastFetchedAt: NOW,
    contentExpiresAt: new Date(NOW.getTime() + 25 * 24 * 60 * 60 * 1000),
    contentHash: null,
    sourceSeenGeneration: null,
    sourceEpoch: 0,
    sourceRevision: 0,
    analysisSequence: 0,
    aiSourceByteLength: 1,
    aiSourceDigest: '0'.repeat(64),
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
    stateRevision: 1,
    submittedAt: NOW,
    approvedAt: NOW,
    publishedAt: null,
    publicationState: 'authorized',
    publicationCycle: 1,
    publicationAttempts: 0,
    publicationLastErrorClass: null,
    reconcileDueAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function publicationAttempt(
  overrides: Partial<PublicationAttemptStart> = {},
): PublicationAttemptStart {
  return {
    providerOperationKey: `publish:${REPLY_A}:1:1`,
    propertyId: PROP_A,
    sourceEpoch: 0,
    materialReviewRevision: 1,
    baseObservationRevision: 0,
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
    await createReviewRepository(db, () => new Date()).upsert(makeReview())
    await createReplyRepository(db, () => new Date()).upsert(makeReply())

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
    const reviewRepo = createReviewRepository(db, () => new Date())
    const replyRepo = createReplyRepository(db, () => new Date())
    const store = createAtomicReplyCommandStore(db, () => new Date())

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
        publicationAttempts: 0,
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
          publicationAttempts: 0,
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
    const reviewRepo = createReviewRepository(db, () => new Date())
    const replyRepo = createReplyRepository(db, () => new Date())
    const store = createAtomicReplyCommandStore(db, () => new Date())

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
        publicationAttempts: 0,
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
            publicationAttempts: 0,
          }),
          event: ghostEvent(cancelledEvent(REPLY_B, 'disconnect')),
          now: NOW,
        },
      ]),
    ).rejects.toThrow(
      /Event type review\.reply\.ghost:v1 is not registered for the outbox/,
    )

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

  it('schedules every active state and defers pending reads without creating new write authority', async () => {
    const db = getDb()
    const reviewRepo = createReviewRepository(db, () => new Date())
    const replyRepo = createReplyRepository(db, () => new Date())
    const store = createAtomicReplyCommandStore(
      db,
      () => new Date(),
      async () => true,
    )

    const review = await reviewRepo.upsert(makeReview())
    const pending = makeReply({
      status: 'pending_approval',
      publicationState: null,
      publicationCycle: 0,
    })
    await replyRepo.upsert(pending)

    const expectDueBoundary = async (dueAt: Date) => {
      await expect(
        replyRepo.findDuePublicationReconciliationBatch(
          new Date(dueAt.getTime() - 1),
          null,
          500,
        ),
      ).resolves.toEqual([])
      await expect(
        replyRepo.findDuePublicationReconciliationBatch(dueAt, null, 500),
      ).resolves.toEqual([
        expect.objectContaining({ id: REPLY_A, reconcileDueAt: dueAt }),
      ])
    }

    const authorized = await store.markPublicationAuthorized(
      pending,
      { status: 'approved', approvedBy: USER_A, approvedAt: NOW },
      {
        lifecycleEvent: null,
        publicationIntent: reviewReplyPublicationRequested({
          replyId: REPLY_A,
          reviewId: REVIEW_A,
          propertyId: PROP_A,
          organizationId: ORG_A,
          userId: USER_A,
          publicationCycle: 1,
          sourceEpoch: review.sourceEpoch,
          materialReviewRevision: review.sourceRevision,
          baseObservationRevision: 0,
          occurredAt: NOW,
        }),
      },
      NOW,
    )
    const authorizedDue = new Date(
      NOW.getTime() + PUBLICATION_RECOVERY_RECONCILE_DELAY_MS,
    )
    expect(authorized).toMatchObject({
      publicationState: 'authorized',
      reconcileDueAt: authorizedDue,
    })
    await expectDueBoundary(authorizedDue)

    const claimed = await store.markPublicationSending(
      authorized!,
      publicationAttempt(),
      NOW,
    )
    const sendingDue = new Date(NOW.getTime() + PUBLICATION_RECOVERY_RECONCILE_DELAY_MS)
    expect(claimed).toMatchObject({
      publicationState: 'sending',
      publicationAttempts: 1,
      reconcileDueAt: sendingDue,
    })
    await expectDueBoundary(sendingDue)

    const providerPending = await store.markProviderOutcomePendingObservation(
      claimed!,
      { providerCorrelationId: 'google-correlation-1', providerRespondedAt: NOW },
      NOW,
    )
    const pendingDue = new Date(NOW.getTime() + PROVIDER_OBSERVATION_RECONCILE_DELAY_MS)
    expect(providerPending).toMatchObject({
      publicationState: 'pending_observation',
      reconcileDueAt: pendingDue,
    })
    await expectDueBoundary(pendingDue)

    const graceObservedAt = new Date(NOW.getTime() + 3 * 60 * 1000)
    const observationStore = createGoogleReplyObservationStore(db)
    const absent = await observationStore.record({
      organizationId: ORG_A,
      propertyId: PROP_A,
      reviewId: REVIEW_A,
      sourceEpoch: review.sourceEpoch,
      materialReviewRevision: review.sourceRevision,
      observationKey: 'a'.repeat(64),
      source: 'targeted_reconciliation',
      publicationTarget: {
        replyId: REPLY_A,
        publicationCycle: 1,
        attemptNumber: 1,
      },
      readGeneration: await observationStore.allocateReadGeneration(),
      observedText: null,
      providerUpdatedAt: null,
      observedAt: graceObservedAt,
      contentExpiresAt: new Date(graceObservedAt.getTime() + 24 * 60 * 60 * 1000),
    })
    expect(absent.resolution).toBe('unchanged')
    await expect(
      replyRepo.findPublicationAttemptObservationProgress({
        organizationId: ORG_A,
        reviewId: REVIEW_A,
        replyId: REPLY_A,
        publicationCycle: 1,
        attemptNumber: 1,
      }),
    ).resolves.toEqual({
      attemptStartedAt: NOW,
      absentObservationCount: 1,
    })

    const deferred = await store.deferPendingPublicationObservation(
      providerPending!,
      graceObservedAt,
    )
    const deferredDue = new Date(
      graceObservedAt.getTime() + PROVIDER_OBSERVATION_RECONCILE_DELAY_MS,
    )
    expect(deferred).toMatchObject({
      status: 'approved',
      publicationState: 'pending_observation',
      publicationAttempts: 1,
      reconcileDueAt: deferredDue,
    })
    await expectDueBoundary(deferredDue)

    const providerWriteAuthority = await pool.query(
      `SELECT
         (SELECT count(*)::int
            FROM reply_publication_attempts
            WHERE organization_id = $1 AND reply_id = $2) AS attempts,
         (SELECT count(*)::int
            FROM outbox_events
            WHERE organization_id = $1
              AND event_type = 'review.reply.publication_requested') AS intents`,
      [ORG_A, REPLY_A],
    )
    expect(providerWriteAuthority.rows[0]).toEqual({ attempts: 1, intents: 1 })

    const ambiguityAt = new Date(NOW.getTime() + 15 * 60 * 1000)
    const marked = await store.markPublicationAmbiguous(
      deferred!,
      reviewReplyPublishFailed({
        replyId: REPLY_A,
        reviewId: REVIEW_A,
        propertyId: PROP_A,
        organizationId: ORG_A,
        authorId: USER_A,
        occurredAt: ambiguityAt,
      }),
      ambiguityAt,
    )
    const ambiguousDue = new Date(ambiguityAt.getTime() + AMBIGUOUS_RECONCILE_DELAY_MS)
    expect(marked).toMatchObject({
      status: 'publish_failed',
      publicationState: 'ambiguous',
      publicationLastErrorClass: 'ambiguous',
      reconcileDueAt: ambiguousDue,
    })
    await expectDueBoundary(ambiguousDue)

    const outbox = await pool.query(
      `SELECT event_type FROM outbox_events WHERE organization_id = $1`,
      [ORG_A],
    )
    expect(outbox.rows.map((r) => r.event_type).sort()).toEqual(
      ['review.reply.publication_requested', 'review.reply.publish_failed'].sort(),
    )
  })

  it('cancelPublications tolerates purge-deleted rows (guarded update matches nothing)', async () => {
    const db = getDb()
    const store = createAtomicReplyCommandStore(db, () => new Date())

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
    const reviewRepo = createReviewRepository(db, () => new Date())
    const replyRepo = createReplyRepository(db, () => new Date())
    const store = createAtomicReplyCommandStore(db, () => new Date())

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
      publicationAttempt(),
      NOW,
    )
    expect(claim).toBeNull()

    const persisted = await replyRepo.findById(REPLY_A, ORG_A)
    expect(persisted?.status).toBe('draft')
    expect(persisted?.publicationState).toBe('cancelled')
  })
})
