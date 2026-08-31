// BQC-3.3 — reply command store integration tests (real Postgres).
//
// Crash-boundary proof on the real database:
//   1. Outbox insert failure (unregistered event type → toOutboxEvent throws)
//      rolls back the state write — no state/outbox split is observable.
//   2. Happy path commits state row AND outbox row with the same eventId.
//   3. SAFE-03 quarantines the legacy purge command before it can erase the
//      stable Review row or RepKey-owned Reply history.

import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
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
  reviewReplyApproved,
  reviewReplyPublicationRequested,
  reviewReplyPublished,
  reviewReplySubmitted,
} from '../../domain/events'
import { createReviewRepository } from './review.repository'
import { createReplyRepository } from './reply.repository'
import { createAtomicReplyCommandStore } from '../reply-command-store'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import { buildConsumerEvent } from '#/shared/outbox/envelope'
import {
  handleReplyPublicationRequested,
  ON_REPLY_PUBLICATION_REQUESTED_CONSUMER,
} from '../outbox-consumers'
import { decideCurrentMemberPropertyAuthority } from '#/contexts/identity/infrastructure/repositories/member-property-authority'
import { withPublicationAuthorizationFixtureMutation } from '#/shared/testing/reply-publication-authorization-fixtures'

const ORG_A = organizationId('org-reply-cmd-aaaa-1111111111111111')
const PROP_A = propertyId('2b000000-0000-0000-0000-000000000001')
const REVIEW_A = reviewId('2b000000-0000-0000-0000-000000000010')
const REPLY_A = replyId('2b000000-0000-0000-0000-000000000020')
const USER_A = userId('user-reply-cmd-aaaa-1111111111')

const NOW = new Date('2025-06-01T12:00:00.000Z')

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
    [PROP_A, ORG_A, 'Reply Cmd Property', 'reply-cmd-prop', 'UTC'],
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
  await withPublicationAuthorizationFixtureMutation(() =>
    p.query('DELETE FROM reply_publication_authorizations WHERE organization_id = $1', [
      ORG_A,
    ]),
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
    externalId: 'ext-reply-cmd-1',
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
    status: 'draft',
    source: 'internal',
    createdBy: USER_A,
    approvedBy: null,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    stateRevision: 1,
    submittedAt: null,
    approvedAt: null,
    publishedAt: null,
    publicationState: null,
    publicationCycle: 0,
    publicationAttempts: 0,
    publicationLastErrorClass: null,
    reconcileDueAt: null,
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
  it('recovers the committed authorization after interruption before direct queue admission', async () => {
    const db = getDb()
    const reviewRepo = createReviewRepository(db, () => new Date())
    const replyRepo = createReplyRepository(db, () => new Date())
    const store = createAtomicReplyCommandStore(
      db,
      silentEvents,
      () => new Date(),
      async () => true,
    )
    const outboxRepo = createOutboxRepository(db)
    const queued: Array<Readonly<{ data: unknown; options: unknown }>> = []

    await reviewRepo.upsert(makeReview())
    const pending = makeReply({
      status: 'pending_approval',
      submittedAt: NOW,
    })
    await replyRepo.upsert(pending)

    const lifecycleEvent = reviewReplyApproved({
      replyId: REPLY_A,
      reviewId: REVIEW_A,
      propertyId: PROP_A,
      organizationId: ORG_A,
      userId: USER_A,
      authorId: USER_A,
      occurredAt: NOW,
    })
    const publicationIntent = reviewReplyPublicationRequested({
      replyId: REPLY_A,
      reviewId: REVIEW_A,
      propertyId: PROP_A,
      organizationId: ORG_A,
      userId: USER_A,
      publicationCycle: 1,
      sourceEpoch: 0,
      materialReviewRevision: 1,
      baseObservationRevision: 0,
      occurredAt: NOW,
    })

    const authorized = await store.markPublicationAuthorized(
      pending,
      { status: 'approved', approvedBy: USER_A, approvedAt: NOW },
      { lifecycleEvent, publicationIntent },
      NOW,
    )

    // Deliberately omit the request-path queue call: this is the exact
    // commit→direct-admission interruption boundary RPL-01 must recover.
    expect(authorized).toMatchObject({
      status: 'approved',
      publicationState: 'authorized',
      publicationCycle: 1,
    })
    const claimed = await outboxRepo.claimUnpublished(1_000, 'rpl-01-test', 30_000)
    const committed = claimed.filter((row) => row.organizationId === ORG_A)
    expect(committed.map((row) => row.eventType).sort()).toEqual([
      'review.reply.approved',
      'review.reply.publication_requested',
    ])
    const committedIntent = committed.find(
      (row) => row.eventType === 'review.reply.publication_requested',
    )
    expect(committedIntent).toBeDefined()

    const result = await handleReplyPublicationRequested(
      {
        replyRepo,
        queue: {
          addPublishJob: async (data, options) => {
            queued.push({ data, options })
          },
        },
        receipts: outboxRepo,
      },
      buildConsumerEvent(committedIntent!),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(queued).toEqual([
      {
        data: {
          replyId: REPLY_A,
          organizationId: ORG_A,
          propertyId: PROP_A,
          publicationCycle: 1,
          sourceEpoch: 0,
          materialReviewRevision: 1,
          baseObservationRevision: 0,
          initiator: { kind: 'user', id: USER_A },
        },
        options: { idempotencyKey: `reply-${REPLY_A}-v1` },
      },
    ])
    await expect(
      outboxRepo.hasReceipt(
        publicationIntent.eventId,
        ON_REPLY_PUBLICATION_REQUESTED_CONSUMER,
      ),
    ).resolves.toBe(true)
  })

  it('keeps committed publication authority append-only at the database boundary', async () => {
    const db = getDb()
    const reviewRepo = createReviewRepository(db, () => new Date())
    const replyRepo = createReplyRepository(db, () => new Date())
    const store = createAtomicReplyCommandStore(
      db,
      silentEvents,
      () => new Date(),
      async () => true,
    )

    await reviewRepo.upsert(makeReview())
    const pending = makeReply({ status: 'pending_approval', submittedAt: NOW })
    await replyRepo.upsert(pending)
    const publicationIntent = reviewReplyPublicationRequested({
      replyId: REPLY_A,
      reviewId: REVIEW_A,
      propertyId: PROP_A,
      organizationId: ORG_A,
      userId: USER_A,
      publicationCycle: 1,
      sourceEpoch: 0,
      materialReviewRevision: 1,
      baseObservationRevision: 0,
      occurredAt: NOW,
    })
    await store.markPublicationAuthorized(
      pending,
      { status: 'approved', approvedBy: USER_A, approvedAt: NOW },
      {
        lifecycleEvent: reviewReplyApproved({
          replyId: REPLY_A,
          reviewId: REVIEW_A,
          propertyId: PROP_A,
          organizationId: ORG_A,
          userId: USER_A,
          authorId: USER_A,
          occurredAt: NOW,
        }),
        publicationIntent,
      },
      NOW,
    )

    for (const statement of [
      `UPDATE reply_publication_authorizations
       SET authorized_by_user_id = 'different-manager'
       WHERE reply_id = '${REPLY_A}'`,
      `DELETE FROM reply_publication_authorizations WHERE reply_id = '${REPLY_A}'`,
      'TRUNCATE reply_publication_authorizations CASCADE',
    ]) {
      await expect(pool.query(statement)).rejects.toMatchObject({ code: '55000' })
    }

    const retained = await pool.query(
      `SELECT authorized_by_user_id, expected_reply_digest
       FROM reply_publication_authorizations
       WHERE reply_id = $1 AND publication_cycle = 1`,
      [REPLY_A],
    )
    expect(retained.rows).toEqual([
      {
        authorized_by_user_id: USER_A,
        expected_reply_digest: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    ])
  })

  it('cancels a queued cycle when its named PropertyManager grant is revoked before claim', async () => {
    const db = getDb()
    const reviewRepo = createReviewRepository(db, () => new Date())
    const replyRepo = createReplyRepository(db, () => new Date())

    await db.execute(sql`
      INSERT INTO "user" (id, name, email, "emailVerified")
      VALUES (${USER_A}, 'Reply Authority Manager', 'reply-authority-manager@example.com', false)
      ON CONFLICT (id) DO NOTHING
    `)
    await db.execute(sql`
      INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
      VALUES ('member-reply-authority-manager', ${USER_A}, ${ORG_A}, 'admin', now())
      ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role
    `)
    await db.execute(sql`
      INSERT INTO property_access_grant (
        organization_id, property_id, user_id, source, created_by
      ) VALUES (${ORG_A}, ${PROP_A}::uuid, ${USER_A}, 'operator', 'test')
      ON CONFLICT (organization_id, property_id, user_id)
        WHERE revoked_at IS NULL
      DO NOTHING
    `)

    const actorAuthority = async (
      tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
      input: Readonly<{
        organizationId: string
        propertyId: string
        userId: string
        at: Date
      }>,
    ) =>
      (
        await decideCurrentMemberPropertyAuthority(tx, {
          ...input,
          permission: 'reply.manage',
        })
      ).allowed
    const store = createAtomicReplyCommandStore(
      db,
      silentEvents,
      () => new Date(),
      actorAuthority,
    )

    await reviewRepo.upsert(makeReview())
    const pending = makeReply({ status: 'pending_approval', submittedAt: NOW })
    await replyRepo.upsert(pending)
    const publicationIntent = reviewReplyPublicationRequested({
      replyId: REPLY_A,
      reviewId: REVIEW_A,
      propertyId: PROP_A,
      organizationId: ORG_A,
      userId: USER_A,
      publicationCycle: 1,
      sourceEpoch: 0,
      materialReviewRevision: 1,
      baseObservationRevision: 0,
      occurredAt: NOW,
    })
    const authorized = await store.markPublicationAuthorized(
      pending,
      { status: 'approved', approvedBy: USER_A, approvedAt: NOW },
      {
        lifecycleEvent: reviewReplyApproved({
          replyId: REPLY_A,
          reviewId: REVIEW_A,
          propertyId: PROP_A,
          organizationId: ORG_A,
          userId: USER_A,
          authorId: USER_A,
          occurredAt: NOW,
        }),
        publicationIntent,
      },
      NOW,
    )
    expect(authorized?.publicationState).toBe('authorized')

    await db.execute(sql`
      UPDATE property_access_grant
      SET revoked_at = now()
      WHERE organization_id = ${ORG_A}
        AND property_id = ${PROP_A}::uuid
        AND user_id = ${USER_A}
        AND revoked_at IS NULL
    `)

    const current = await replyRepo.findById(REPLY_A, ORG_A)
    expect(current).not.toBeNull()
    const claim = await store.markPublicationSending(
      current!,
      {
        providerOperationKey: 'revoked-manager-must-not-send:1',
        propertyId: PROP_A,
        sourceEpoch: 0,
        materialReviewRevision: 1,
        baseObservationRevision: 0,
      },
      new Date(NOW.getTime() + 1_000),
    )

    expect(claim).toBeNull()
    await expect(replyRepo.findById(REPLY_A, ORG_A)).resolves.toMatchObject({
      status: 'draft',
      publicationState: 'cancelled',
    })
    const attempts = await pool.query(
      'SELECT id FROM reply_publication_attempts WHERE organization_id = $1',
      [ORG_A],
    )
    expect(attempts.rows).toHaveLength(0)
    const cancellation = await pool.query(
      `SELECT payload
       FROM outbox_events
       WHERE organization_id = $1
         AND event_type = 'review.reply.publication_cancelled'`,
      [ORG_A],
    )
    expect(cancellation.rows).toHaveLength(1)
    expect(cancellation.rows[0].payload).toMatchObject({ cause: 'policy' })
  })

  it('rolls back authorization and its lifecycle fact when the publication-intent insert fails', async () => {
    const db = getDb()
    const reviewRepo = createReviewRepository(db, () => new Date())
    const replyRepo = createReplyRepository(db, () => new Date())
    const store = createAtomicReplyCommandStore(
      db,
      silentEvents,
      () => new Date(),
      async () => true,
    )

    await reviewRepo.upsert(makeReview())
    const pending = makeReply({ status: 'pending_approval', submittedAt: NOW })
    await replyRepo.upsert(pending)

    const lifecycleEvent = reviewReplyApproved({
      replyId: REPLY_A,
      reviewId: REVIEW_A,
      propertyId: PROP_A,
      organizationId: ORG_A,
      userId: USER_A,
      authorId: USER_A,
      occurredAt: NOW,
    })
    const invalidIntent = unregisteredEvent(
      reviewReplyPublicationRequested({
        replyId: REPLY_A,
        reviewId: REVIEW_A,
        propertyId: PROP_A,
        organizationId: ORG_A,
        userId: USER_A,
        publicationCycle: 1,
        sourceEpoch: 0,
        materialReviewRevision: 1,
        baseObservationRevision: 0,
        occurredAt: NOW,
      }),
    )

    await expect(
      store.markPublicationAuthorized(
        pending,
        { status: 'approved', approvedBy: USER_A, approvedAt: NOW },
        { lifecycleEvent, publicationIntent: invalidIntent as never },
        NOW,
      ),
    ).rejects.toThrow(
      /Event type review\.reply\.ghost:v1 is not registered for the outbox/,
    )

    expect(await replyRepo.findById(REPLY_A, ORG_A)).toMatchObject({
      status: 'pending_approval',
      publicationCycle: 0,
    })
    const outbox = await pool.query(
      'SELECT id FROM outbox_events WHERE organization_id = $1',
      [ORG_A],
    )
    expect(outbox.rows).toHaveLength(0)
  })

  it('rolls back the state write when the outbox insert fails (no state/outbox split)', async () => {
    const db = getDb()
    const reviewRepo = createReviewRepository(db, () => new Date())
    const replyRepo = createReplyRepository(db, () => new Date())
    const store = createAtomicReplyCommandStore(db, silentEvents, () => new Date())

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
    ).rejects.toThrow(
      /Event type review\.reply\.ghost:v1 is not registered for the outbox/,
    )

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
    const reviewRepo = createReviewRepository(db, () => new Date())
    const store = createAtomicReplyCommandStore(db, silentEvents, () => new Date())

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
    ).rejects.toThrow(
      /Event type review\.reply\.ghost:v1 is not registered for the outbox/,
    )

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
    const reviewRepo = createReviewRepository(db, () => new Date())
    const replyRepo = createReplyRepository(db, () => new Date())
    const store = createAtomicReplyCommandStore(db, silentEvents, () => new Date())

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
    // Identifier-only payload on the real pipeline (BQC-3.7: correlationId is
    // envelope-grade metadata re-attached post-validation — an identifier).
    expect(Object.keys(outbox.rows[0].payload).sort()).toEqual([
      'correlationId',
      'occurredAt',
      'organizationId',
      'propertyId',
      'replyId',
      'reviewId',
      'source',
      'userId',
    ])
  })

  it('quarantines purgeExpiredReview without erasing the review, reply, or recording a false expiry fact', async () => {
    const db = getDb()
    const reviewRepo = createReviewRepository(db, () => new Date())
    const replyRepo = createReplyRepository(db, () => new Date())
    const store = createAtomicReplyCommandStore(db, silentEvents, () => new Date())

    await reviewRepo.upsert(makeReview())
    await replyRepo.upsert(makeReply())

    const event = reviewExpired({
      reviewId: REVIEW_A,
      propertyId: PROP_A,
      organizationId: ORG_A,
      occurredAt: NOW,
    })

    await expect(store.purgeExpiredReview(REVIEW_A, event)).rejects.toThrow(
      'Review destructive lifecycle is quarantined',
    )

    const found = await reviewRepo.findById(REVIEW_A, ORG_A)
    expect(found?.id).toBe(REVIEW_A)
    expect((await replyRepo.findById(REPLY_A, ORG_A))?.id).toBe(REPLY_A)
    const outbox = await pool.query(
      `SELECT id, event_type FROM outbox_events WHERE organization_id = $1`,
      [ORG_A],
    )
    expect(outbox.rows).toHaveLength(0)
  })
})
