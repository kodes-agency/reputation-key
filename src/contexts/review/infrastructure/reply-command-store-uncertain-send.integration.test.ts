// D3/D4 — uncertain-send grace, ambiguous read ladder and never-dispatched
// settlement on the real database.
//
// Each command is a compare-and-set on status, publication_state,
// publication_cycle and publication_attempts. These tests drive a real
// authorize → claim so the attempt row, its created_at and the DB triggers
// and CHECK constraints are the production ones, then prove:
//   1. the attempt start the grace and the ladder are measured from;
//   2. deferral and rescheduling move only reconcile_due_at, and the sweep's
//      due query picks the row up exactly when that time arrives;
//   3. settlement makes the row not published and safe to retry, with the
//      publish_failed fact recorded once per failure a manager can see;
//   4. every stale snapshot loses the CAS without a write or a fact.

import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool, type PoolClient } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import {
  organizationId,
  propertyId,
  reviewId,
  replyId,
  userId,
} from '#/shared/domain/ids'
import type { Reply, Review } from '../domain/types'
import {
  reviewReplyPublicationRequested,
  reviewReplyPublishFailed,
} from '../domain/events'
import { AMBIGUOUS_RECONCILE_DELAY_MS } from '../domain/reply-publication-workflow'
import { createReviewRepository } from './repositories/review.repository'
import { createReplyRepository } from './repositories/reply.repository'
import { createAtomicReplyCommandStore } from './reply-command-store'

const ORG_A = organizationId('org-uncertain-send-cccc-33333333333')
const ORG_OTHER = organizationId('org-uncertain-send-dddd-44444444444')
const PROP_A = propertyId('3e000000-0000-0000-0000-000000000001')
const REVIEW_A = reviewId('3e000000-0000-0000-0000-000000000010')
const REPLY_A = replyId('3e000000-0000-0000-0000-000000000020')
const USER_A = userId('user-uncertain-send-cccc-3333333')

const STARTED_AT = new Date('2026-09-14T14:22:43.000Z')
const minutesAfterStart = (minutes: number) =>
  new Date(STARTED_AT.getTime() + minutes * 60_000)

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
    templateId: null,
    templateVersion: null,
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

const publishFailed = (occurredAt: Date) =>
  reviewReplyPublishFailed({
    replyId: REPLY_A,
    reviewId: REVIEW_A,
    propertyId: PROP_A,
    organizationId: ORG_A,
    authorId: USER_A,
    outcome: 'unconfirmed',
    occurredAt,
  })

/** A real authorize → claim, so the attempt row starts at STARTED_AT. */
async function claimOneAttempt() {
  const db = getDb()
  const reviewRepo = createReviewRepository(db, () => new Date())
  const replyRepo = createReplyRepository(db, () => new Date())
  const store = createAtomicReplyCommandStore(
    db,
    () => new Date(),
    async () => true,
  )
  const review = await reviewRepo.upsert(makeReview())
  const pending = await replyRepo.upsert(pendingReply())
  const authorized = await store.markPublicationAuthorized(
    pending,
    { status: 'approved', approvedBy: USER_A, approvedAt: STARTED_AT },
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

async function persisted() {
  const reply = await pool.query(
    `SELECT status, publication_state, publication_last_error_class,
            publication_attempts, reconcile_due_at
       FROM replies WHERE id = $1`,
    [REPLY_A],
  )
  const attempt = await pool.query(
    `SELECT outcome FROM reply_publication_attempts
      WHERE reply_id = $1 AND publication_cycle = 1 AND attempt_number = 1`,
    [REPLY_A],
  )
  const facts = await pool.query(
    `SELECT count(*)::int AS n FROM outbox_events
      WHERE organization_id = $1 AND event_type = 'review.reply.publish_failed'`,
    [ORG_A],
  )
  return {
    ...reply.rows[0],
    attemptOutcome: attempt.rows[0]?.outcome,
    publishFailedFacts: facts.rows[0].n as number,
  }
}

async function dueIds(
  replyRepo: ReturnType<typeof createReplyRepository>,
  now: Date,
): Promise<string[]> {
  const batch = await replyRepo.findDuePublicationReconciliationBatch(now, null, 500)
  return batch.filter((r) => r.organizationId === ORG_A).map((r) => r.id)
}

/** The locking core of the issuer's publication check: the exact attempt, only
 * while it and its Reply are still sending, share-locked until commit. */
const ADMISSION_LOCK_SQL = `
  SELECT attempt.id
    FROM reply_publication_attempts AS attempt
    INNER JOIN replies AS reply
      ON reply.organization_id = attempt.organization_id
     AND reply.review_id = attempt.review_id
     AND reply.id = attempt.reply_id
   WHERE attempt.reply_id = $1
     AND attempt.publication_cycle = 1
     AND attempt.attempt_number = 1
     AND attempt.outcome = 'sending'
     AND reply.status = 'approved'
     AND reply.publication_state = 'sending'
     AND reply.publication_attempts = attempt.attempt_number
   LIMIT 1
   FOR SHARE OF attempt`

const RECOVERY_RUN_ID = '3e000000-0000-4000-8000-000000000099'

/** Deterministic wait: the database reports a backend blocked by `holder`. */
async function waitUntilBlockedBy(holder: PoolClient): Promise<void> {
  const pid = (await holder.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
    .rows[0]!.pid
  for (let poll = 0; poll < 400; poll++) {
    const blocked = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))',
      [pid],
    )
    if (blocked.rows[0]!.n > 0) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('no statement waited on the held lock')
}

async function insertReplyPermit(client: PoolClient, attemptNumber: number) {
  const admittedAt = minutesAfterStart(5)
  await client.query(
    `INSERT INTO authorization_execution_permits (
       id, capability, organization_id, property_id, connection_id,
       operation_key, route_key, route_catalog_version, quota_policy_id,
       authorization_vector, state, admitted_at, start_deadline_at
     ) VALUES (
       gen_random_uuid(), 'property.publish_reply', $1, $2, gen_random_uuid(),
       'reviews.reply', 'reviews.reply', 'test-v1', 'test-quota', $3::jsonb,
       'admitted', $4, $5
     )`,
    [
      ORG_A,
      PROP_A,
      JSON.stringify({
        replyId: REPLY_A,
        publicationCycle: 1,
        publicationAttemptNumber: attemptNumber,
      }),
      admittedAt,
      new Date(admittedAt.getTime() + 10_000),
    ],
  )
}

async function insertRecoveryRun(client: PoolClient, completedAt: Date) {
  await client.query(
    `INSERT INTO recovery_runs (
       id, generation, source_release_sha, source_manifest_sha256,
       restore_point_at, operator_id, correlation_id, counts, completed_at,
       created_at
     )
     SELECT $1, COALESCE(MAX(generation), 0) + 1, $2, $3, $4,
            'uncertain-send-restore@example.invalid', 'uncertain-send-restore',
            '{}'::jsonb, $5, $5
       FROM recovery_runs`,
    [RECOVERY_RUN_ID, 'a'.repeat(40), 'b'.repeat(64), STARTED_AT, completedAt],
  )
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 5 })
  clearEventSchemas()
  registerAllEventSchemas()
})

afterAll(async () => {
  clearEventSchemas()
  await pool.end()
})

beforeEach(async () => {
  await clearTenant(pool)
  await seedOrgAndProperty(pool)
})

describe.sequential('uncertain send commands (integration, D3/D4)', () => {
  it('reads the exact attempt start, tenant-scoped', async () => {
    const { replyRepo } = await claimOneAttempt()
    const ref = {
      organizationId: ORG_A,
      reviewId: REVIEW_A,
      replyId: REPLY_A,
      publicationCycle: 1,
      attemptNumber: 1,
    }

    await expect(replyRepo.findCurrentPublicationAttemptStartedAt(ref)).resolves.toEqual(
      STARTED_AT,
    )
    await expect(
      replyRepo.findCurrentPublicationAttemptStartedAt({ ...ref, attemptNumber: 2 }),
    ).resolves.toBeNull()
    await expect(
      replyRepo.findCurrentPublicationAttemptStartedAt({ ...ref, publicationCycle: 2 }),
    ).resolves.toBeNull()
    await expect(
      replyRepo.findCurrentPublicationAttemptStartedAt({
        ...ref,
        organizationId: ORG_OTHER,
      }),
    ).resolves.toBeNull()
  })

  it('defers a sending row inside the grace, and the sweep picks it up when due', async () => {
    const { store, replyRepo, sending } = await claimOneAttempt()
    const now = minutesAfterStart(1)
    const dueAt = minutesAfterStart(2)

    const deferred = await store.deferUncertainSend(sending, dueAt, now)

    expect(deferred).toMatchObject({
      status: 'approved',
      publicationState: 'sending',
      publicationAttempts: 1,
      reconcileDueAt: dueAt,
    })
    expect(await persisted()).toMatchObject({
      status: 'approved',
      publication_state: 'sending',
      reconcile_due_at: dueAt,
      attemptOutcome: 'sending',
      publishFailedFacts: 0,
    })
    expect(await dueIds(replyRepo, new Date(dueAt.getTime() - 1))).toEqual([])
    expect(await dueIds(replyRepo, dueAt)).toEqual([REPLY_A])
    // Deferral never re-opens the single-use claim.
    await expect(
      store.markPublicationSending(
        deferred!,
        {
          providerOperationKey: `publish:${REPLY_A}:1:2`,
          propertyId: PROP_A,
          sourceEpoch: 0,
          materialReviewRevision: 1,
          baseObservationRevision: 0,
        },
        now,
      ),
    ).resolves.toBeNull()
  })

  it('refuses a deferral whose snapshot lost the compare-and-set', async () => {
    const { store, sending } = await claimOneAttempt()
    const now = minutesAfterStart(1)
    const dueAt = minutesAfterStart(2)

    await expect(
      store.deferUncertainSend({ ...sending, publicationAttempts: 2 }, dueAt, now),
    ).resolves.toBeNull()
    await expect(
      store.deferUncertainSend({ ...sending, publicationCycle: 2 }, dueAt, now),
    ).resolves.toBeNull()

    await store.markPublicationAmbiguous(sending, publishFailed(now), now)
    await expect(store.deferUncertainSend(sending, dueAt, now)).resolves.toBeNull()
    expect(await persisted()).toMatchObject({
      publication_state: 'ambiguous',
      reconcile_due_at: new Date(now.getTime() + AMBIGUOUS_RECONCILE_DELAY_MS),
    })
  })

  it('marks ambiguity at the ladder time and reschedules it on the ladder', async () => {
    const { store, replyRepo, sending } = await claimOneAttempt()
    const now = minutesAfterStart(16)
    const firstRung = minutesAfterStart(30)

    const ambiguous = await store.markPublicationAmbiguous(
      sending,
      publishFailed(now),
      now,
      firstRung,
    )
    expect(ambiguous).toMatchObject({
      status: 'publish_failed',
      publicationState: 'ambiguous',
      reconcileDueAt: firstRung,
    })
    expect(await dueIds(replyRepo, firstRung)).toEqual([REPLY_A])

    const secondRung = minutesAfterStart(60)
    const rescheduled = await store.rescheduleAmbiguousReconciliation(
      ambiguous!,
      secondRung,
      firstRung,
    )

    expect(rescheduled).toMatchObject({
      status: 'publish_failed',
      publicationState: 'ambiguous',
      publicationLastErrorClass: 'ambiguous',
      reconcileDueAt: secondRung,
    })
    expect(await persisted()).toMatchObject({
      reconcile_due_at: secondRung,
      attemptOutcome: 'ambiguous',
      publishFailedFacts: 1,
    })
    expect(await dueIds(replyRepo, firstRung)).toEqual([])
    expect(await dueIds(replyRepo, secondRung)).toEqual([REPLY_A])
  })

  it('refuses a reschedule whose snapshot lost the compare-and-set', async () => {
    const { store, sending } = await claimOneAttempt()
    const now = minutesAfterStart(16)
    const dueAt = minutesAfterStart(30)

    await expect(
      store.rescheduleAmbiguousReconciliation(sending, dueAt, now),
    ).resolves.toBeNull()
    const ambiguous = await store.markPublicationAmbiguous(
      sending,
      publishFailed(now),
      now,
    )
    await expect(
      store.rescheduleAmbiguousReconciliation(
        { ...ambiguous!, publicationAttempts: 2 },
        dueAt,
        now,
      ),
    ).resolves.toBeNull()

    await store.markPublicationTerminal(ambiguous!, 'ambiguous', null, now)
    await expect(
      store.rescheduleAmbiguousReconciliation(ambiguous!, dueAt, now),
    ).resolves.toBeNull()
    expect(await persisted()).toMatchObject({
      publication_state: 'terminal',
      reconcile_due_at: null,
    })
  })

  it('settles a never-dispatched sending attempt as not published, with one fact', async () => {
    const { store, replyRepo, sending } = await claimOneAttempt()
    const now = minutesAfterStart(6)

    const settled = await store.settleNeverDispatchedAttempt(
      sending,
      publishFailed(now),
      now,
    )

    expect(settled).toMatchObject({
      status: 'publish_failed',
      publicationState: 'terminal',
      publicationLastErrorClass: 'retryable',
      reconcileDueAt: null,
    })
    expect(await persisted()).toMatchObject({
      status: 'publish_failed',
      publication_state: 'terminal',
      publication_last_error_class: 'retryable',
      reconcile_due_at: null,
      attemptOutcome: 'retryable_failure',
      publishFailedFacts: 1,
    })
    expect(await dueIds(replyRepo, minutesAfterStart(72 * 60))).toEqual([])

    // The same snapshot again lost the CAS: no write and no second fact.
    await expect(
      store.settleNeverDispatchedAttempt(sending, publishFailed(now), now),
    ).resolves.toBeNull()
    expect((await persisted()).publishFailedFacts).toBe(1)
  })

  it.each([
    ['ambiguous', 'ambiguous'],
    ['terminal ambiguity', 'terminal'],
  ] as const)('settles %s without repeating the failure fact', async (_label, from) => {
    const { store, sending } = await claimOneAttempt()
    const failedAt = minutesAfterStart(1)
    let uncertain = await store.markPublicationAmbiguous(
      sending,
      publishFailed(failedAt),
      failedAt,
    )
    if (from === 'terminal') {
      uncertain = await store.markPublicationTerminal(
        uncertain!,
        'ambiguous',
        null,
        minutesAfterStart(20),
      )
    }
    const now = minutesAfterStart(30)

    const settled = await store.settleNeverDispatchedAttempt(
      uncertain!,
      publishFailed(now),
      now,
    )

    expect(settled).toMatchObject({
      status: 'publish_failed',
      publicationState: 'terminal',
      publicationLastErrorClass: 'retryable',
      reconcileDueAt: null,
    })
    expect(await persisted()).toMatchObject({
      attemptOutcome: 'retryable_failure',
      publishFailedFacts: 1,
    })
  })

  // Finding: the evidence read happens before the settle transaction, so a
  // permit admitted in between used to be invisible to it. The issuer's
  // publication check holds FOR SHARE on the attempt row until its permit
  // commits (google-content-authorization-check.ts loadPublicationAttempt);
  // these tests hold that same lock from a second connection.
  it('refuses to settle while a permit admission holds the attempt, once that permit commits', async () => {
    const { store, sending } = await claimOneAttempt()
    const now = minutesAfterStart(6)
    const admission = await pool.connect()
    try {
      await admission.query('BEGIN')
      const locked = await admission.query(ADMISSION_LOCK_SQL, [REPLY_A])
      expect(locked.rowCount).toBe(1)

      const settling = store.settleNeverDispatchedAttempt(
        sending,
        publishFailed(now),
        now,
      )
      await waitUntilBlockedBy(admission)
      await insertReplyPermit(admission, 1)
      await admission.query('COMMIT')

      await expect(settling).resolves.toBeNull()
    } finally {
      await admission.query('ROLLBACK')
      admission.release()
    }
    expect(await persisted()).toMatchObject({
      status: 'approved',
      publication_state: 'sending',
      attemptOutcome: 'sending',
      publishFailedFacts: 0,
    })
  })

  it('denies a permit admission that waited on a settle once the settle commits', async () => {
    await claimOneAttempt()
    const settle = await pool.connect()
    const admission = await pool.connect()
    try {
      await settle.query('BEGIN')
      await settle.query(
        `UPDATE reply_publication_attempts SET outcome = 'retryable_failure'
          WHERE reply_id = $1 AND publication_cycle = 1 AND attempt_number = 1`,
        [REPLY_A],
      )
      await admission.query('BEGIN')
      const admitting = admission.query(ADMISSION_LOCK_SQL, [REPLY_A])
      await waitUntilBlockedBy(settle)
      await settle.query('COMMIT')

      // READ COMMITTED re-checks the locked row's new version: no longer sending.
      await expect(admitting).resolves.toMatchObject({ rowCount: 0 })
    } finally {
      await settle.query('ROLLBACK')
      await admission.query('ROLLBACK')
      settle.release()
      admission.release()
    }
  })

  it('refuses to settle an attempt that a restore may have lost the permit for', async () => {
    const { store, sending } = await claimOneAttempt()
    const now = minutesAfterStart(6)
    const restore = await pool.connect()
    try {
      await restore.query('BEGIN')
      await insertRecoveryRun(restore, minutesAfterStart(3))
      await restore.query('COMMIT')

      await expect(
        store.settleNeverDispatchedAttempt(sending, publishFailed(now), now),
      ).resolves.toBeNull()
    } finally {
      await restore.query('DELETE FROM recovery_runs WHERE id = $1', [RECOVERY_RUN_ID])
      restore.release()
    }
    expect(await persisted()).toMatchObject({
      publication_state: 'sending',
      attemptOutcome: 'sending',
      publishFailedFacts: 0,
    })
  })

  // The restore fence's own UPDATE (postgres-recovery-fence.ts) leaves the row
  // approved/ambiguous. The sweep ends it with markPublicationTerminal; the
  // terminal ambiguity that results must still never be settled as unsent.
  it('ends a restore-fenced row as terminal ambiguity that stays unsettleable', async () => {
    const { store, replyRepo } = await claimOneAttempt()
    await pool.query(
      `UPDATE replies
          SET publication_state = 'ambiguous',
              publication_last_error_class = 'ambiguous',
              reconcile_due_at = clock_timestamp(),
              updated_at = clock_timestamp()
        WHERE id = $1 AND publication_state = 'sending'`,
      [REPLY_A],
    )
    const fenced = (await replyRepo.findById(REPLY_A, ORG_A))!
    expect(fenced).toMatchObject({ status: 'approved', publicationState: 'ambiguous' })
    const now = minutesAfterStart(30)

    await expect(
      store.settleNeverDispatchedAttempt(fenced, publishFailed(now), now),
    ).resolves.toBeNull()
    await expect(
      store.rescheduleAmbiguousReconciliation(fenced, minutesAfterStart(60), now),
    ).resolves.toBeNull()
    const ended = await store.markPublicationTerminal(
      fenced,
      'ambiguous',
      publishFailed(now),
      now,
    )
    expect(ended).toMatchObject({
      status: 'publish_failed',
      publicationState: 'terminal',
      publicationLastErrorClass: 'ambiguous',
      reconcileDueAt: null,
    })

    const restore = await pool.connect()
    try {
      await insertRecoveryRun(restore, minutesAfterStart(20))
      await expect(
        store.settleNeverDispatchedAttempt(ended!, publishFailed(now), now),
      ).resolves.toBeNull()
    } finally {
      await restore.query('DELETE FROM recovery_runs WHERE id = $1', [RECOVERY_RUN_ID])
      restore.release()
    }
    expect(await persisted()).toMatchObject({
      status: 'publish_failed',
      publication_state: 'terminal',
      publication_last_error_class: 'ambiguous',
      attemptOutcome: 'ambiguous',
      publishFailedFacts: 1,
    })
  })

  it('refuses to settle a row that is not an uncertain send', async () => {
    const { store, sending } = await claimOneAttempt()
    const now = minutesAfterStart(6)
    const rejected = await store.markPublicationTerminal(
      sending,
      'terminal_rejection',
      publishFailed(now),
      now,
    )

    await expect(
      store.settleNeverDispatchedAttempt(rejected!, publishFailed(now), now),
    ).resolves.toBeNull()
    // A snapshot that claims ambiguity cannot overwrite the stored rejection.
    await expect(
      store.settleNeverDispatchedAttempt(
        { ...rejected!, publicationLastErrorClass: 'ambiguous' },
        publishFailed(now),
        now,
      ),
    ).resolves.toBeNull()
    expect(await persisted()).toMatchObject({
      publication_last_error_class: 'terminal_rejection',
      attemptOutcome: 'terminal_rejection',
      publishFailedFacts: 1,
    })
  })
})
