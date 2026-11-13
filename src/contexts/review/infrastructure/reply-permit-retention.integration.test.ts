// Google permit retention against real PostgreSQL. The sweep ages out finished
// permits after 30 days, except a `reviews.reply` permit whose publication
// attempt is still uncertain: that permit is the only proof a reply attempt
// never left RepKey, and the resend decision reads it whatever its age.

import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { replyScopeEffects } from '#/contexts/reputation/application/public-api'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import {
  createRetentionSweepHandler,
  createScheduledRetentionSweepHandler,
  RETENTION_RULES,
} from '#/shared/jobs/retention-sweep.job'
import {
  organizationId,
  propertyId,
  reviewId,
  replyId,
  userId,
} from '#/shared/domain/ids'
import type { Reply, Review } from '../domain/types'
import { reviewReplyApproved, reviewReplyPublicationRequested } from '../domain/events'
import { createReviewRepository } from './repositories/review.repository'
import { createReplyRepository } from './repositories/reply.repository'
import { createAtomicReplyCommandStore } from './reply-command-store'

const ORG_A = organizationId('org-permit-retention-aaaa-1111111111')
const PROP_A = propertyId('a93f0000-0000-0000-0000-000000000001')
const REVIEW_A = reviewId('a93f0000-0000-0000-0000-000000000010')
const REPLY_A = replyId('a93f0000-0000-0000-0000-000000000020')
const USER_A = userId('user-permit-retention-aaaa-111111')

const STARTED_AT = new Date('2026-09-14T14:22:43.000Z')
const SWEEP_AT = new Date('2026-11-13T03:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const SUBJECT = 'authorization_execution_permits.expired'
const rule = RETENTION_RULES.find((candidate) => candidate.subject === SUBJECT)!

let pool: Pool

async function seedOrgAndProperty(p: Pool) {
  const slug = 't-' + ORG_A.replace(/-/g, '').slice(-12)
  const conflicting = await p.query<{ id: string }>(
    `SELECT id FROM organization WHERE slug = $1 AND id <> $2`,
    [slug, ORG_A],
  )
  await deleteTestOrganizations(
    p,
    conflicting.rows.map(({ id }) => id),
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
    [PROP_A, ORG_A, 'Uncertain Send Property', 'uncertain-send-prop', 'UTC'],
  )
}

async function clearTenant(p: Pool) {
  for (const table of [
    'authorization_execution_permits',
    'google_reply_observation_heads',
    'google_reply_observations',
    'reply_publication_attempts',
    'reply_publication_authorizations',
    'outbox_events',
    'replies',
    'reviews',
  ]) {
    await p.query(`DELETE FROM ${table} WHERE organization_id = $1`, [ORG_A])
  }
  await p.query(`DELETE FROM retention_runs WHERE subject = $1`, [SUBJECT])
}

function makeReview(): Review {
  const expiresAt = new Date(STARTED_AT.getTime() + 25 * 24 * 60 * 60 * 1000)
  return {
    id: REVIEW_A,
    organizationId: ORG_A,
    propertyId: PROP_A,
    platform: 'google',
    externalId: 'ext-uncertain-send-1',
    externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
    googleConnectionId: null,
    reviewerName: 'Jane Doe',
    reviewerProfilePhotoUrl: null,
    googleReviewUrl: null,
    rating: 5,
    text: 'Great place!',
    translatedText: null,
    languageCode: 'en',
    reviewedAt: STARTED_AT,
    expiresAt,
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: STARTED_AT,
    sourceUpdatedAt: null,
    firstFetchedAt: STARTED_AT,
    lastFetchedAt: STARTED_AT,
    contentExpiresAt: expiresAt,
    contentHash: null,
    sourceSeenGeneration: null,
    sourceEpoch: 0,
    sourceRevision: 0,
    analysisSequence: 0,
    aiSourceByteLength: 1,
    aiSourceDigest: '0'.repeat(64),
    createdAt: STARTED_AT,
    updatedAt: STARTED_AT,
  }
}

function pendingReply(): Reply {
  return {
    id: REPLY_A,
    reviewId: REVIEW_A,
    organizationId: ORG_A,
    text: 'Thank you for staying with us.\nSee you next time!',
    status: 'pending_approval',
    source: 'internal',
    createdBy: USER_A,
    approvedBy: null,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    stateRevision: 1,
    submittedAt: STARTED_AT,
    approvedAt: null,
    publishedAt: null,
    publicationState: null,
    publicationCycle: 0,
    publicationAttempts: 0,
    publicationLastErrorClass: null,
    reconcileDueAt: null,
    createdAt: STARTED_AT,
    updatedAt: STARTED_AT,
  }
}

/** A real authorize → claim, so the attempt row starts at STARTED_AT. */
async function claimOneAttempt() {
  const db = getDb()
  const reviewRepo = createReviewRepository(
    db,
    () => new Date(),
    undefined,
    replyScopeEffects,
  )
  const replyRepo = createReplyRepository(db, () => new Date())
  const store = createAtomicReplyCommandStore(
    db,
    () => new Date(),
    async () => true,
    undefined,
    replyScopeEffects,
  )
  const review = await reviewRepo.upsert(makeReview())
  const pending = await replyRepo.upsert(pendingReply())
  const authorized = await store.markPublicationAuthorized(
    pending,
    { status: 'approved', approvedBy: USER_A, approvedAt: STARTED_AT },
    {
      lifecycleEvent: reviewReplyApproved({
        replyId: REPLY_A,
        reviewId: REVIEW_A,
        propertyId: PROP_A,
        organizationId: ORG_A,
        userId: USER_A,
        authorId: USER_A,
        occurredAt: STARTED_AT,
      }),
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
        occurredAt: STARTED_AT,
      }),
    },
    STARTED_AT,
  )
  const sending = await store.markPublicationSending(
    authorized!,
    {
      providerOperationKey: `publish:${REPLY_A}:1:1`,
      propertyId: PROP_A,
      sourceEpoch: review.sourceEpoch,
      materialReviewRevision: review.sourceRevision,
      baseObservationRevision: 0,
    },
    STARTED_AT,
  )
  expect(sending).toMatchObject({ publicationState: 'sending', publicationAttempts: 1 })
  return { store, replyRepo, sending: sending! }
}

const swept = (batchSize = 500) =>
  createRetentionSweepHandler({
    db: getDb(),
    clock: () => SWEEP_AT,
    rules: [rule],
    batchSize,
  })({} as never)

async function insertPermit(
  routeKey: string,
  ageDays: number,
  vector: Record<string, unknown> = {},
): Promise<string> {
  const id = randomUUID()
  const admittedAt = new Date(SWEEP_AT.getTime() - ageDays * DAY_MS)
  await pool.query(
    `INSERT INTO authorization_execution_permits (
       id, capability, organization_id, property_id, connection_id,
       operation_key, route_key, route_catalog_version, quota_policy_id,
       authorization_vector, state, admitted_at, start_deadline_at, started_at,
       operation_deadline_at, completed_at, created_at
     ) VALUES (
       $1, 'property.publish_reply', $2, $3, gen_random_uuid(), $4, $4,
       'test-v1', 'test-quota', $5::jsonb, 'completed', $6, $7, $6, $8, $9, $6
     )`,
    [
      id,
      ORG_A,
      PROP_A,
      routeKey,
      JSON.stringify(vector),
      admittedAt,
      new Date(admittedAt.getTime() + 10_000),
      new Date(admittedAt.getTime() + 30_000),
      new Date(admittedAt.getTime() + 2_000),
    ],
  )
  return id
}

const replyVector = (replyKey: string = REPLY_A) => ({
  replyId: replyKey,
  publicationCycle: 1,
  publicationAttemptNumber: 1,
})

async function permitIds(): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM authorization_execution_permits WHERE organization_id = $1',
    [ORG_A],
  )
  return rows.map(({ id }) => id)
}

type ReplyStateCase = Readonly<{
  name: string
  status: string
  publicationState: string
  errorClass: string | null
  attemptOutcome: string
  keptByRule: boolean
}>

const REPLY_STATES: ReadonlyArray<ReplyStateCase> = [
  {
    name: 'sending',
    status: 'approved',
    publicationState: 'sending',
    errorClass: null,
    attemptOutcome: 'sending',
    keptByRule: true,
  },
  {
    name: 'accepted and awaiting observation',
    status: 'approved',
    publicationState: 'pending_observation',
    errorClass: null,
    attemptOutcome: 'provider_outcome_pending',
    keptByRule: true,
  },
  {
    name: 'ambiguous on the read ladder',
    status: 'publish_failed',
    publicationState: 'ambiguous',
    errorClass: 'ambiguous',
    attemptOutcome: 'ambiguous',
    keptByRule: true,
  },
  {
    name: 'terminal ambiguity',
    status: 'publish_failed',
    publicationState: 'terminal',
    errorClass: 'ambiguous',
    attemptOutcome: 'ambiguous',
    keptByRule: true,
  },
  {
    name: 'settled as not published',
    status: 'publish_failed',
    publicationState: 'terminal',
    errorClass: 'retryable',
    attemptOutcome: 'retryable_failure',
    keptByRule: false,
  },
  {
    name: 'rejected by Google',
    status: 'publish_failed',
    publicationState: 'terminal',
    errorClass: 'terminal_rejection',
    attemptOutcome: 'terminal_rejection',
    keptByRule: false,
  },
]

async function setReplyState(state: ReplyStateCase): Promise<void> {
  await pool.query(
    `UPDATE replies SET status = $2::reply_status, publication_state = $3,
            publication_last_error_class = $4 WHERE id = $1`,
    [REPLY_A, state.status, state.publicationState, state.errorClass],
  )
  await pool.query(
    `UPDATE reply_publication_attempts SET outcome = $2
      WHERE reply_id = $1 AND publication_cycle = 1 AND attempt_number = 1`,
    [REPLY_A, state.attemptOutcome],
  )
}

/** What the resend command decides for the reply as it stands: a settle that returns a row would let it be sent again. */
async function resendDecision(): Promise<'settled' | 'refused'> {
  const db = getDb()
  const reply = await createReplyRepository(db, () => new Date()).findById(REPLY_A, ORG_A)
  const store = createAtomicReplyCommandStore(
    db,
    () => new Date(),
    async () => true,
    undefined,
    replyScopeEffects,
  )
  const settled = await store.settleNeverDispatchedAttempt(reply!, null, SWEEP_AT)
  return settled ? 'settled' : 'refused'
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 3 })
  clearEventSchemas()
  registerAllEventSchemas()
})

afterAll(async () => {
  await clearTenant(pool)
  clearEventSchemas()
  await pool.end()
})

beforeEach(async () => {
  await clearTenant(pool)
  await seedOrgAndProperty(pool)
})

describe.sequential('Google permit retention (PostgreSQL)', () => {
  it('deletes nothing while scheduled retention is inactive', async () => {
    await insertPermit('reviews.get', 90)

    await expect(
      createScheduledRetentionSweepHandler({
        db: getDb(),
        clock: () => SWEEP_AT,
        rules: [rule],
      })({} as never),
    ).resolves.toEqual({ mode: 'inactive' })

    expect(await permitIds()).toHaveLength(1)
  })

  it('deletes aged permits of other routes in bounded batches and keeps recent ones', async () => {
    const aged = await Promise.all(
      Array.from({ length: 7 }, (_, index) =>
        insertPermit(index % 2 === 0 ? 'reviews.get' : 'reviews.list', 31 + index),
      ),
    )
    const recent = await insertPermit('reviews.get', 29)

    await swept(3)

    expect(await permitIds()).toEqual([recent])
    const { rows } = await pool.query(
      `SELECT batches, rows_deleted, outcome FROM retention_runs
        WHERE subject = $1 AND started_at = $2`,
      [SUBJECT, SWEEP_AT],
    )
    expect(aged).toHaveLength(7)
    expect(rows).toEqual([{ batches: 3, rows_deleted: 7, outcome: 'completed' }])
  })

  it('ages out the permit of a reply that no longer exists', async () => {
    await insertPermit('reviews.reply', 400, replyVector(randomUUID()))

    await swept()

    expect(await permitIds()).toEqual([])
  })

  it('skips a permit another transaction holds and takes it on the next run', async () => {
    const held = await insertPermit('reviews.get', 60)
    const free = await insertPermit('reviews.get', 61)
    const holder = await pool.connect()
    try {
      await holder.query('BEGIN')
      await holder.query(
        'SELECT id FROM authorization_execution_permits WHERE id = $1 FOR UPDATE',
        [held],
      )

      await swept()
      expect(await permitIds()).toEqual([held])
    } finally {
      await holder.query('ROLLBACK')
      holder.release()
    }

    expect(free).not.toBe(held)
    await swept()
    expect(await permitIds()).toEqual([])
  })

  it.each(REPLY_STATES)(
    'keeps the resend decision for a reply $name the same after the sweep',
    async (state) => {
      await claimOneAttempt()
      await setReplyState(state)
      const permit = await insertPermit('reviews.reply', 400, replyVector())
      const before = await resendDecision()

      await swept()

      expect(await permitIds()).toEqual(state.keptByRule ? [permit] : [])
      expect(await resendDecision()).toBe(before)
      expect(before).toBe('refused')
    },
  )
})
