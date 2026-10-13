// Test-only: the reply workflow as production runs it, on PostgreSQL.
//
// The manager commands are the real use cases over the real reply repository,
// command store, observation store and dispatch evidence. The publish worker and
// the reconciliation sweep are the real job handlers. Only three things are
// stand-ins: Google (an upsert endpoint that remembers what it was sent), the
// queue (it keeps the jobs the commands enqueue) and the clock. An AI
// suggestion is adopted through the real acceptance store and judged by the
// real binding (testing/reply-workflow-ai-fixture.ts).
//
// Google is the witness. Every request that leaves RepKey is written to
// `google.sent` with the text it carried, and `google.live` is what a guest
// would see. A test can therefore compare what RepKey records with what Google
// received, which is the comparison the reply invariants are about.

import type { Job } from 'bullmq'
import type { Pool } from 'pg'
import { getDb } from '#/shared/db'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  replyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import { sha256Hex } from '#/shared/domain/sha256'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { deleteTestOrganizationsWithExecutor } from '#/shared/db/testing/test-organization-cleanup'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { Reply, Review, StarRating } from '../../domain/types'
import { reviewReplyPublicationCancelled, reviewUpdated } from '../../domain/events'
import { replyAuthor } from '../../domain/reply-author'
import { googleReplyTextDigest } from '../../domain/google-reply-observation'
import type {
  GoogleReplyPublicationRequest,
  GoogleReviewApiPort,
} from '../../application/ports/google-review-api.port'
import type { PublishReplyJobData } from '../../application/ports/reply-queue.port'
import {
  approveReply,
  deleteReply,
  draftReply,
  editPublishedReply,
  rejectReply,
  retryPublish,
  submitReply,
  type ReplyDeps,
  type ReplyOnScreen,
} from '../../application/use-cases/reply-operations'
import { reconcileReplyPublication } from '../../application/use-cases/reconcile-reply-publication'
import { createReviewRepository } from '../repositories/review.repository'
import { createReplyRepository } from '../repositories/reply.repository'
import { createAtomicReplyCommandStore } from '../reply-command-store'
import { createAtomicReviewCommandStore } from '../review-command-store'
import { createGoogleReplyObservationStore } from '../google-reply-observation-store'
import { createReplyPublicationDispatchEvidence } from '../reply-publication-dispatch-evidence'
import { createPublishReplyHandler } from '../jobs/publish-reply.job'
import { createReconcileAmbiguousPublicationsHandler } from '../jobs/reconcile-ambiguous-publications.job'
import { createReplyWorkflowAiFixture } from './reply-workflow-ai-fixture'

export const WORKFLOW_ORG = organizationId('org-reply-workflow-model-00000001')
export const WORKFLOW_PROPERTY = propertyId('4f000000-0000-4000-8000-000000000001')
export const WORKFLOW_REVIEW = reviewId('4f000000-0000-4000-8000-000000000010')
export const WORKFLOW_MANAGER = userId('user-reply-workflow-model-000001')
const CONNECTION = '4f000000-0000-4000-8000-000000000030'
const EXTERNAL_REVIEW_ID = 'ext-reply-workflow-model-1'
// Far in the future on purpose. Dispatch evidence refuses to prove anything
// about an attempt that started before the latest recovery run completed, and
// `recovery_runs` is one table for the whole database: another suite's leftover
// run, stamped with the real clock, must not date itself after these attempts.
const STARTED_AT = new Date('2090-01-01T08:00:00.000Z')
const CONTENT_TTL_MS = 25 * 24 * 60 * 60 * 1000
const MAX_JOB_ATTEMPTS = 5
/** Seeding and removing the workflow's Organization is a few dozen statements;
 * the default ten seconds is not enough on a machine that is busy. */
export const WORKFLOW_HOOK_TIMEOUT_MS = 60_000

/** What the stand-in Google does with the next reply write it is sent. */
export type GoogleWriteOutcome =
  /** Accepted and answered: the reply is live. */
  | 'accepted'
  /** Answered 400: nothing is posted. */
  | 'rejected'
  /** Refused inside RepKey before any request left: no permit, nothing posted. */
  | 'not_sent'
  /** The worker died after its claim and before any request left: no permit,
   * nothing posted, and nothing recorded that says so. */
  | 'crashed'
  /** The request left and Google took it, but no answer came back. */
  | 'timeout_landed'
  /** The request left and no answer came back; Google never took it. */
  | 'timeout_lost'

/** One reply write that left RepKey. */
export type SentReply = Readonly<{
  replyId: string
  publicationCycle: number
  attemptNumber: number
  text: string
  /** Whether Google took it (its text is then `google.live`). */
  landed: boolean
}>

export type ReplyEvidence = Readonly<{
  reply: Reply | null
  authorizations: ReadonlyArray<
    Readonly<{ publicationCycle: number; expectedReplyDigest: string }>
  >
  attempts: ReadonlyArray<
    Readonly<{
      publicationCycle: number
      attemptNumber: number
      outcome: string
      startedAt: Date
    }>
  >
  /** Reply facts in the outbox, by event type. */
  facts: Readonly<Record<string, number>>
}>

type QueuedPublishJob = Readonly<{ id: string; data: PublishReplyJobData }>

const MANAGER_CTX: AuthContext = {
  userId: WORKFLOW_MANAGER,
  organizationId: WORKFLOW_ORG,
  role: 'AccountAdmin',
}

const TENANT_TABLES = [
  'authorization_execution_permits',
  'google_reply_observation_heads',
  'google_reply_observations',
  'reply_publication_attempts',
  'reply_publication_authorizations',
  'outbox_events',
  'replies',
] as const

/** Marks the failures the stand-in Google raises on purpose. */
const SIMULATED = Symbol('simulated provider failure')

function abortError(): Error {
  return Object.assign(new Error('The reply write timed out'), {
    name: 'AbortError',
    [SIMULATED]: true,
  })
}

function providerError(
  dispatch: 'not_sent' | 'answered',
  providerStatus: number | null,
): Error {
  return Object.assign(new Error('The reply write failed'), {
    _tag: 'GoogleReviewApiError' as const,
    code: 'provider_unavailable' as const,
    recoverable: dispatch === 'not_sent',
    failure: { executionCode: null, dispatch, providerStatus },
    [SIMULATED]: true,
  })
}

const isSimulated = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && SIMULATED in error

function seedReview(locationName: string): Omit<Review, 'createdAt' | 'updatedAt'> {
  const expiresAt = new Date(STARTED_AT.getTime() + CONTENT_TTL_MS)
  return {
    id: WORKFLOW_REVIEW,
    organizationId: WORKFLOW_ORG,
    propertyId: WORKFLOW_PROPERTY,
    platform: 'google',
    externalId: EXTERNAL_REVIEW_ID,
    externalLocationId: locationName,
    googleConnectionId: googleConnectionId(CONNECTION),
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
  }
}

export type ReplyWorkflowHarness = Awaited<ReturnType<typeof createReplyWorkflowHarness>>

/**
 * `locationName` and `logger` come from the test: the generated Google
 * identifier fixtures and the shared test helpers are the test's to import,
 * not this context's infrastructure.
 */
export async function createReplyWorkflowHarness(
  input: Readonly<{ pool: Pool; locationName: string; logger: LoggerPort }>,
) {
  const { pool, locationName, logger } = input
  const db = getDb()
  let nowMs = STARTED_AT.getTime()
  const clock = () => new Date(nowMs)

  const reviewRepo = createReviewRepository(db, clock)
  const replyRepo = createReplyRepository(db, clock)
  const commandStore = createAtomicReplyCommandStore(db, clock, async () => true)
  const reviewCommandStore = createAtomicReviewCommandStore(db, clock)
  const observationStore = createGoogleReplyObservationStore(db)
  const dispatchEvidence = createReplyPublicationDispatchEvidence(db)
  const ai = createReplyWorkflowAiFixture({
    organizationId: WORKFLOW_ORG,
    propertyId: WORKFLOW_PROPERTY,
    reviewId: WORKFLOW_REVIEW,
    actorUserId: WORKFLOW_MANAGER,
  })

  // ── Google ───────────────────────────────────────────────────────────
  const google = {
    live: null as Readonly<{ text: string; updatedAt: Date }> | null,
    /** Reply writes the worker asked for, whether or not a request left. */
    calls: 0,
    /** The text of each of those writes. A worker asks only for a reply it has
     * claimed, so this is the witness of what was ever claimed for sending. */
    asked: [] as Array<Readonly<{ replyId: string; text: string }>>,
    sent: [] as SentReply[],
    /** Rules a reply write broke at the moment it left RepKey. */
    violations: [] as string[],
    next: 'accepted' as GoogleWriteOutcome,
    /** Set to hold the next write open after its request has left RepKey. */
    gate: null as Readonly<{ entered: () => void; release: Promise<void> }> | null,
  }

  async function insertPermit(input: GoogleReplyPublicationRequest): Promise<void> {
    const admittedAt = clock()
    await pool.query(
      `INSERT INTO authorization_execution_permits (
         id, capability, organization_id, property_id, connection_id,
         operation_key, route_key, route_catalog_version, quota_policy_id,
         authorization_vector, state, admitted_at, start_deadline_at,
         started_at, operation_deadline_at
       ) VALUES (
         gen_random_uuid(), 'property.publish_reply', $1, $2, $3,
         $4, 'reviews.reply', 'test-v1', 'test-quota', $5::jsonb,
         'started', $6, $7, $6, $7
       )`,
      [
        WORKFLOW_ORG,
        WORKFLOW_PROPERTY,
        CONNECTION,
        `reviews.reply:${input.replyId}:${input.publicationCycle}:${input.attemptNumber}`,
        JSON.stringify({
          replyId: input.replyId,
          publicationCycle: input.publicationCycle,
          publicationAttemptNumber: input.attemptNumber,
        }),
        admittedAt,
        new Date(admittedAt.getTime() + 10_000),
      ],
    )
  }

  /** Whether a worker asked Google for this text of this reply before. */
  const wasClaimedBefore = (reply: Readonly<{ replyId: string; text: string }>) =>
    google.asked.some(
      (asked) => asked.replyId === reply.replyId && asked.text === reply.text,
    )

  /** Unedited AI text leaves only while its binding is current, or, once it
   * was claimed for sending before, after its adoption window alone has
   * passed. Never after something it was generated from changed. */
  async function checkAiTextAsItLeaves(
    input: GoogleReplyPublicationRequest,
    claimedBefore: boolean,
  ) {
    const sent = replyId(input.replyId)
    if ((await ai.bindingOf(sent)) !== 'stale') return
    if (!claimedBefore) {
      google.violations.push(
        `cycle ${input.publicationCycle} sent AI text that was stale before any claim`,
      )
    } else if (!(await ai.inputsCurrentOf(sent))) {
      google.violations.push(
        `cycle ${input.publicationCycle} sent AI text after something it was generated from changed`,
      )
    }
  }

  /** The rules a write must satisfy as it leaves: it carries text, the text
   * that was authorized for its cycle, no earlier request for this reply is
   * still of unknown outcome (Review CONTEXT, Invariant 9), and it is not
   * unedited AI text the last gate should have held. */
  async function checkWriteAsItLeaves(
    input: GoogleReplyPublicationRequest,
    claimedBefore: boolean,
  ) {
    if (input.text.trim() === '') {
      google.violations.push(`cycle ${input.publicationCycle} sent a reply with no text`)
    }
    await checkAiTextAsItLeaves(input, claimedBefore)
    const authorization = await pool.query<{ expected_reply_digest: string }>(
      `SELECT expected_reply_digest FROM reply_publication_authorizations
        WHERE reply_id = $1 AND publication_cycle = $2`,
      [input.replyId, input.publicationCycle],
    )
    if (
      authorization.rows[0]?.expected_reply_digest !== googleReplyTextDigest(input.text)
    ) {
      google.violations.push(
        `cycle ${input.publicationCycle} sent text that was not the text authorized for it`,
      )
    }
    const uncertain = await pool.query<{ publication_cycle: number }>(
      `SELECT attempt.publication_cycle::int AS publication_cycle
         FROM reply_publication_attempts AS attempt
        WHERE attempt.reply_id = $1
          AND attempt.outcome IN ('sending', 'provider_outcome_pending', 'ambiguous')
          AND (attempt.publication_cycle, attempt.attempt_number) <> ($2, $3)`,
      [input.replyId, input.publicationCycle, input.attemptNumber],
    )
    const dispatchedEarlier = uncertain.rows.filter((row) =>
      google.sent.some(
        (sent) =>
          sent.replyId === input.replyId &&
          sent.publicationCycle === row.publication_cycle,
      ),
    )
    if (dispatchedEarlier.length > 0) {
      google.violations.push(
        `cycle ${input.publicationCycle} was sent while cycle ${dispatchedEarlier[0]!.publication_cycle} was still of unknown outcome`,
      )
    }
  }

  const googleReviewApi: GoogleReviewApiPort = {
    listReviewsPage: async () => {
      throw new Error('listReviewsPage is not part of the reply workflow')
    },
    discardReviewCursors: async () => {},
    getReview: async () => ({
      status: 'found',
      review: {
        reviewName: `${locationName}/reviews/${EXTERNAL_REVIEW_ID}`,
        externalId: EXTERNAL_REVIEW_ID,
        externalLocationId: locationName,
        reviewerName: 'Jane Doe',
        reviewerProfilePhotoUrl: null,
        rating: 5,
        text: 'Great place!',
        translatedText: null,
        languageCode: 'en',
        reviewedAt: STARTED_AT,
        replyText: google.live?.text ?? null,
        replyUpdatedAt: google.live?.updatedAt ?? null,
      },
    }),
    replyToReview: async (input) => {
      const outcome = google.next
      const claimedBefore = wasClaimedBefore(input)
      google.calls += 1
      google.asked.push({ replyId: input.replyId, text: input.text })
      if (outcome === 'not_sent') throw providerError('not_sent', null)
      if (outcome === 'crashed') throw abortError()

      await checkWriteAsItLeaves(input, claimedBefore)
      await insertPermit(input)
      const landed = outcome === 'accepted' || outcome === 'timeout_landed'
      google.sent.push({
        replyId: input.replyId,
        publicationCycle: input.publicationCycle,
        attemptNumber: input.attemptNumber,
        text: input.text,
        landed,
      })
      if (landed) google.live = { text: input.text, updatedAt: clock() }
      const gate = google.gate
      if (gate) {
        google.gate = null
        gate.entered()
        await gate.release
      }
      if (outcome === 'rejected') throw providerError('answered', 400)
      if (outcome !== 'accepted') throw abortError()
      return {
        providerCorrelationId: `google-${input.publicationCycle}-${input.attemptNumber}`,
      }
    },
  }

  // Reply ids are counted, not random, so a failing sequence replays exactly.
  let replySequence = 0
  const nextReplyId = () => {
    replySequence += 1
    return replyId(`4f000000-0000-4000-8000-1${String(replySequence).padStart(11, '0')}`)
  }

  // ── Queue ────────────────────────────────────────────────────────────
  const jobs: QueuedPublishJob[] = []
  const jobRuns = new Map<string, number>()

  const staffPublicApi: StaffPublicApi = {
    getAccessiblePropertyIds: async () => null,
    getAssignedPortals: async () => [],
  }

  const replyDeps: ReplyDeps = {
    replyRepo,
    reviewRepo,
    queue: {
      addPublishJob: async (data, options) => {
        const id = options?.idempotencyKey ?? `publish-${jobs.length}`
        // BullMQ drops a second add under the same job id.
        if (!jobs.some((job) => job.id === id)) jobs.push({ id, data })
      },
    },
    commandStore,
    aiSuggestedDraftStore: ai.store,
    dispatchEvidence,
    googleReplyObservationStore: observationStore,
    propertyPublicationScope: {
      getPublicationScope: async () => ({ lifecycle: 'active', sourceEpoch: 0 }),
    },
    clock,
    idGen: nextReplyId,
    staffPublicApi,
  }

  const publishHandler = createPublishReplyHandler({
    replyRepo,
    reviewRepo,
    googleReviewApi,
    googleReplyObservationStore: observationStore,
    replyCommandStore: commandStore,
    dispatchEvidence,
    clock,
    logger,
    idGen: nextReplyId,
    staffPublicApi,
  })

  const reconcile = reconcileReplyPublication({
    replyRepo,
    reviewRepo,
    googleReviewApi,
    observationStore,
    clock,
  })

  const useCases = {
    draft: draftReply(replyDeps),
    submit: submitReply(replyDeps),
    approve: approveReply(replyDeps),
    reject: rejectReply(replyDeps),
    retry: retryPublish(replyDeps),
    editPublished: editPublishedReply(replyDeps),
    delete: deleteReply(replyDeps),
  }
  const reviewInput = { reviewId: WORKFLOW_REVIEW }

  async function reset(): Promise<void> {
    // A confirmed attempt and the observation that confirmed it reference each
    // other; the link is released first, as the Organization purge does.
    await pool.query(
      `UPDATE reply_publication_attempts
          SET outcome = 'superseded', confirmed_observation_revision = NULL
        WHERE organization_id = $1 AND confirmed_observation_revision IS NOT NULL`,
      [WORKFLOW_ORG],
    )
    for (const table of TENANT_TABLES) {
      await pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [WORKFLOW_ORG])
    }
    await ai.reset()
    nowMs = STARTED_AT.getTime()
    google.live = null
    google.calls = 0
    google.asked = []
    google.sent = []
    google.violations = []
    google.next = 'accepted'
    google.gate = null
    jobs.length = 0
    jobRuns.clear()
    replySequence = 0
  }

  async function seed(): Promise<void> {
    await remove()
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, 'Reply workflow model', $2, NOW())`,
      [WORKFLOW_ORG, `reply-workflow-model-${process.pid}`],
    )
    await pool.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
       VALUES ($1, $2, 'Reply workflow property', $3, 'UTC', NOW(), NOW())`,
      [WORKFLOW_PROPERTY, WORKFLOW_ORG, `reply-workflow-model-${process.pid}`],
    )
    await pool.query(
      `INSERT INTO google_connections
         (id, organization_id, google_subject, encrypted_access_token,
          encrypted_refresh_token, token_expires_at, scopes, connected_by,
          credential_authorized_by, credential_authorized_at, visibility, status,
          credential_use_state, created_at, updated_at, status_changed_at)
       VALUES ($1, $2, $3, 'sealed-access', 'sealed-refresh', $4,
               ARRAY['business.manage'], $5, $5, $4,
               'organization', 'active', 'active', $4, $4, $4)`,
      [
        CONNECTION,
        WORKFLOW_ORG,
        `reply-workflow-model-${process.pid}`,
        STARTED_AT,
        WORKFLOW_MANAGER,
      ],
    )
    await reviewRepo.upsert(seedReview(locationName), STARTED_AT)
    await ai.seed()
  }

  async function remove(): Promise<void> {
    await reset()
    for (const table of ['reviews', 'properties', 'google_connections']) {
      await pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [WORKFLOW_ORG])
    }
    await deleteTestOrganizationsWithExecutor(pool, [WORKFLOW_ORG])
    await ai.restore()
  }

  async function currentReply(): Promise<Reply | null> {
    return replyRepo.findInternalByReviewId(WORKFLOW_REVIEW, WORKFLOW_ORG)
  }

  async function evidence(): Promise<ReplyEvidence> {
    const authorizations = await pool.query<{
      publication_cycle: number
      expected_reply_digest: string
    }>(
      `SELECT publication_cycle::int AS publication_cycle, expected_reply_digest
         FROM reply_publication_authorizations
        WHERE organization_id = $1 ORDER BY publication_cycle`,
      [WORKFLOW_ORG],
    )
    const attempts = await pool.query<{
      publication_cycle: number
      attempt_number: number
      outcome: string
      created_at: Date
    }>(
      `SELECT publication_cycle::int AS publication_cycle,
              attempt_number::int AS attempt_number, outcome, created_at
         FROM reply_publication_attempts
        WHERE organization_id = $1 ORDER BY publication_cycle, attempt_number`,
      [WORKFLOW_ORG],
    )
    const facts = await pool.query<{ event_type: string; n: number }>(
      `SELECT event_type, count(*)::int AS n FROM outbox_events
        WHERE organization_id = $1 AND event_type LIKE 'review.reply.%'
        GROUP BY event_type`,
      [WORKFLOW_ORG],
    )
    return {
      reply: await currentReply(),
      authorizations: authorizations.rows.map((row) => ({
        publicationCycle: row.publication_cycle,
        expectedReplyDigest: row.expected_reply_digest,
      })),
      attempts: attempts.rows.map((row) => ({
        publicationCycle: row.publication_cycle,
        attemptNumber: row.attempt_number,
        outcome: row.outcome,
        startedAt: row.created_at,
      })),
      facts: Object.fromEntries(facts.rows.map((row) => [row.event_type, row.n])),
    }
  }

  /**
   * One execution of a queued publish job, as BullMQ would deliver it. Returns
   * false when the job has no execution left. `final` makes it the last of the
   * job's five executions.
   */
  async function runPublishJob(
    jobIndex: number,
    outcome: GoogleWriteOutcome,
    final = false,
  ): Promise<boolean> {
    const job = jobs[jobIndex]
    if (!job) return false
    const runs = jobRuns.get(job.id) ?? 0
    if (runs >= MAX_JOB_ATTEMPTS) return false
    const attemptsMade = final ? MAX_JOB_ATTEMPTS - 1 : runs
    jobRuns.set(job.id, attemptsMade + 1)
    google.next = outcome
    try {
      await publishHandler({
        id: job.id,
        attemptsMade,
        data: job.data,
      } as Job<PublishReplyJobData>)
    } catch (error) {
      // A failed execution is BullMQ's to retry; the row already says what
      // happened. Anything the stand-in Google did not raise is a real fault.
      if (!isSimulated(error)) throw error
    }
    return true
  }

  /** The reconciliation sweep, over this suite's rows only. `afterBatchRead`
   * runs once the sweep holds its batch and before it settles any row. */
  async function runSweep(afterBatchRead?: () => Promise<void>): Promise<void> {
    let pending = afterBatchRead
    const handler = createReconcileAmbiguousPublicationsHandler({
      replyRepo: {
        ...replyRepo,
        findDuePublicationReconciliationBatch: async (now, cursor, limit) => {
          const batch = await replyRepo.findDuePublicationReconciliationBatch(
            now,
            cursor,
            limit,
          )
          const own = batch.filter((reply) => reply.organizationId === WORKFLOW_ORG)
          if (pending) {
            const run = pending
            pending = undefined
            await run()
          }
          return own
        },
      },
      reviewRepo,
      replyCommandStore: commandStore,
      dispatchEvidence,
      reconcileReplyPublication: reconcile,
      clock,
      logger,
      runLease: { tryAcquire: async () => ({ release: async () => {} }) },
    })
    await handler({} as Job)
  }

  /** A Google disconnect: every publication not yet dispatched is cancelled. */
  async function cancelUndispatched(): Promise<number> {
    const undispatched = await replyRepo.findUndispatchedPublicationsByReviewIds(
      [WORKFLOW_REVIEW],
      WORKFLOW_ORG,
    )
    const now = clock()
    return commandStore.cancelPublications(
      undispatched.map((reply) => ({
        reply,
        event: reviewReplyPublicationCancelled({
          replyId: reply.id,
          reviewId: reply.reviewId,
          propertyId: WORKFLOW_PROPERTY,
          organizationId: WORKFLOW_ORG,
          authorId: replyAuthor(reply),
          cause: 'disconnect',
          occurredAt: now,
        }),
        now,
      })),
    )
  }

  /** A review sync that reads the reply Google currently shows. */
  async function observeGoogle(): Promise<void> {
    const review = await reviewRepo.findById(WORKFLOW_REVIEW, WORKFLOW_ORG)
    if (!review) throw new Error('The workflow review is missing')
    const readGeneration = await observationStore.allocateReadGeneration()
    const observedAt = clock()
    await observationStore.record({
      organizationId: WORKFLOW_ORG,
      propertyId: WORKFLOW_PROPERTY,
      reviewId: WORKFLOW_REVIEW,
      sourceEpoch: review.sourceEpoch,
      materialReviewRevision: review.sourceRevision,
      readGeneration,
      observationKey: sha256Hex(`reply-workflow-snapshot:${readGeneration}`),
      source: 'provider_snapshot',
      observedText: google.live?.text ?? null,
      providerUpdatedAt: google.live?.updatedAt ?? null,
      observedAt,
      contentExpiresAt: new Date(observedAt.getTime() + CONTENT_TTL_MS),
    })
  }

  /**
   * A review sync that reads the Review with `change` applied and records it
   * through the store sync uses for a Review whose content differs, with its
   * `review.updated` fact. A changed rating or text is a guest edit: Review
   * records the next Material Review Revision. Anything else is the same
   * revision observed again.
   */
  async function observeReviewChange(
    change: Partial<Pick<Review, 'rating' | 'text' | 'reviewerName'>>,
  ): Promise<Review> {
    const observedAt = clock()
    return reviewCommandStore.upsertAndRecord(
      {
        ...seedReview(locationName),
        ...change,
        sourceUpdatedAt: observedAt,
        lastFetchedAt: observedAt,
      },
      (review) =>
        reviewUpdated({
          reviewId: review.id,
          organizationId: WORKFLOW_ORG,
          propertyId: WORKFLOW_PROPERTY,
          platform: 'google',
          sourceEpoch: review.sourceEpoch,
          sourceRevision: review.sourceRevision,
          analysisSequence: review.analysisSequence,
          occurredAt: observedAt,
        }),
      observedAt,
      sha256Hex(`reply-workflow-review-change:${JSON.stringify(change)}`),
      'ongoing',
    )
  }

  /** The guest rewrote the review: a new rating, new text, or both. */
  const observeGuestEdit = (
    edit: Readonly<{ rating: StarRating; text: string }>,
  ): Promise<Review> => observeReviewChange(edit)

  return {
    seed,
    reset,
    remove,
    clock,
    advance: (ms: number) => {
      nowMs += ms
    },
    google,
    wasClaimedBefore,
    jobs: jobs as ReadonlyArray<QueuedPublishJob>,
    replyRepo,
    commandStore,
    currentReply,
    evidence,
    runPublishJob,
    runSweep,
    cancelUndispatched,
    observeGoogle,
    observeReviewChange,
    observeGuestEdit,
    /** Hold the next reply write open after its request has left RepKey. */
    holdNextWrite: () => {
      let entered!: () => void
      let release!: () => void
      const reached = new Promise<void>((resolve) => {
        entered = resolve
      })
      google.gate = {
        entered,
        release: new Promise<void>((resolve) => {
          release = resolve
        }),
      }
      return { reached, release }
    },
    ai: {
      /** The ten-minute adoption window of every AI-assisted reply is over. */
      letWindowPass: ai.letWindowPass,
      /** What the real binding says about a reply right now. */
      bindingOf: ai.bindingOf,
      /** The same, apart from the adoption window. */
      inputsCurrentOf: ai.inputsCurrentOf,
      /** Whether a reply's ten-minute adoption window has passed. */
      pastItsWindow: ai.pastItsWindow,
      /** Something the Property's AI-assisted replies were generated from
       * changes, and the transaction that changes it runs the AI draft purge. */
      changeInput: ai.changeProcessingProfile,
      /** A sync sees the unchanged Review: the purge for replies past their window. */
      observeReviewAgain: ai.observeReviewAgain,
    },
    commands: {
      draft: (text: string) => useCases.draft({ ...reviewInput, text }, MANAGER_CTX),
      /** A manager adopts an AI suggestion, unedited, as the review's draft. */
      adoptAiSuggestion: async (text: string) =>
        useCases.draft(
          { ...reviewInput, text, provenanceToken: await ai.issueSuggestion(text) },
          MANAGER_CTX,
        ),
      submit: () => useCases.submit(reviewInput, MANAGER_CTX),
      /** `expectedReply`: the reply the manager's screen showed, and its revision. */
      approve: (expectedReply?: ReplyOnScreen) =>
        useCases.approve(
          expectedReply === undefined ? reviewInput : { ...reviewInput, expectedReply },
          MANAGER_CTX,
        ),
      reject: () => useCases.reject(reviewInput, MANAGER_CTX),
      retry: () => useCases.retry(reviewInput, MANAGER_CTX),
      editPublished: (text: string) =>
        useCases.editPublished({ ...reviewInput, text }, MANAGER_CTX),
      delete: () => useCases.delete(reviewInput, MANAGER_CTX),
    },
  }
}
