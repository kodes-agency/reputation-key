// Archiving a Property cancels its undispatched reply publications (PostgreSQL).
//
// The provider authorizer refuses a write unless the Property is active at the
// cycle's source epoch, and the publish worker used to report that refusal as
// a terminal "Google rejected the reply" failure, which sends the author an
// urgent notice. Two owners now settle such a cycle as a policy cancellation
// (publication_state 'cancelled', the Reply back to draft, one
// `publication_cancelled` fact with cause 'policy'):
//   - the archive consumer, for every cycle not yet dispatched whose source
//     epoch is behind the Property's, however late the fact arrives;
//   - the worker's claim, which locks the Property and refuses a cycle whose
//     Property is not active at its epoch, whichever of the two runs first.

import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Queue } from 'bullmq'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import { createConsumerRegistry, type ConsumerEvent } from '#/shared/outbox'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  replyId,
  reviewId,
  userId,
  type OrganizationId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { propertyArchived } from '#/contexts/property/domain/events'
import type { Reply, Review } from '../domain/types'
import { reviewReplyApproved, reviewReplyPublicationRequested } from '../domain/events'
import { buildReviewContext } from '../build'
import { createReviewRepository } from './repositories/review.repository'
import { createReplyRepository } from './repositories/reply.repository'
import { createAtomicReplyCommandStore } from './reply-command-store'
import { createGoogleReplyObservationStore } from './google-reply-observation-store'
import { createPublishReplyHandler } from './jobs/publish-reply.job'

const ORG = organizationId('org-archive-publication-000000000001')
const PROPERTY = propertyId('2c000000-0000-4000-8000-000000000001')
const REVIEW = reviewId('2c000000-0000-4000-8000-000000000010')
const REPLY = replyId('2c000000-0000-4000-8000-000000000020')
const AUTHOR = userId('user-archive-publication-000000001')
const CONNECTION = '2c000000-0000-4000-8000-000000000030'
const NOW = new Date('2026-09-22T09:00:00.000Z')
const ARCHIVED_AT = new Date('2026-09-22T09:05:00.000Z')

const db = getDb()
let pool: Pool

async function clean(): Promise<void> {
  for (const table of [
    'reply_publication_attempts',
    'reply_publication_authorizations',
    'outbox_events',
    'replies',
    'reviews',
    'properties',
    'google_connections',
  ]) {
    await pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [ORG])
  }
  await deleteTestOrganizations(pool, [ORG])
}

async function seed(): Promise<void> {
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Archive publication', $2, NOW())`,
    [ORG, `archive-publication-${process.pid}`],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Archive publication property', $3, 'UTC', NOW(), NOW())`,
    [PROPERTY, ORG, `archive-publication-${process.pid}`],
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
    [CONNECTION, ORG, `archive-publication-subject-${process.pid}`, NOW, AUTHOR],
  )
}

const review = (): Review => ({
  id: REVIEW,
  organizationId: ORG,
  propertyId: PROPERTY,
  platform: 'google',
  externalId: 'ext-archive-publication-1',
  externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
  googleConnectionId: googleConnectionId(CONNECTION),
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
})

const pendingReply = (): Reply => ({
  id: REPLY,
  reviewId: REVIEW,
  organizationId: ORG,
  text: 'Thank you for the kind words!',
  status: 'pending_approval',
  source: 'internal',
  createdBy: AUTHOR,
  approvedBy: null,
  rejectedBy: null,
  rejectionReason: null,
  aiGenerated: false,
  stateRevision: 1,
  submittedAt: NOW,
  approvedAt: null,
  publishedAt: null,
  publicationState: null,
  publicationCycle: 0,
  publicationAttempts: 0,
  publicationLastErrorClass: null,
  reconcileDueAt: null,
  templateId: null,
  templateVersion: null,
  createdAt: NOW,
  updatedAt: NOW,
})

/**
 * Approve the reply through the production command store: cycle 1, authorized
 * at `sourceEpoch`, the epoch the Property and its Review were observed at.
 */
async function authorizeReply(sourceEpoch = 0): Promise<void> {
  await pool.query(`UPDATE properties SET source_epoch = $2 WHERE id = $1`, [
    PROPERTY,
    sourceEpoch,
  ])
  await createReviewRepository(db, () => NOW).upsert({ ...review(), sourceEpoch })
  const pending = pendingReply()
  await createReplyRepository(db, () => NOW).upsert(pending)
  const authorized = await createAtomicReplyCommandStore(
    db,
    () => NOW,
    async () => true,
  ).markPublicationAuthorized(
    pending,
    { status: 'approved', approvedBy: AUTHOR, approvedAt: NOW },
    {
      lifecycleEvent: reviewReplyApproved({
        replyId: REPLY,
        reviewId: REVIEW,
        propertyId: PROPERTY,
        organizationId: ORG,
        userId: AUTHOR,
        authorId: AUTHOR,
        occurredAt: NOW,
      }),
      publicationIntent: reviewReplyPublicationRequested({
        replyId: REPLY,
        reviewId: REVIEW,
        propertyId: PROPERTY,
        organizationId: ORG,
        userId: AUTHOR,
        publicationCycle: 1,
        sourceEpoch,
        materialReviewRevision: 1,
        baseObservationRevision: 0,
        occurredAt: NOW,
      }),
    },
    NOW,
  )
  expect(authorized).toMatchObject({ publicationState: 'authorized' })
}

/** The Property row as its lifecycle command left it. */
async function readProperty(orgId: OrganizationId, pid: PropertyId) {
  const { rows } = await pool.query<{ lifecycle_state: string; source_epoch: number }>(
    `SELECT lifecycle_state, source_epoch
     FROM properties WHERE organization_id = $1 AND id = $2`,
    [orgId, pid],
  )
  return rows[0] ?? null
}

const propertyApi = {
  getSourceEpoch: async (orgId: OrganizationId, pid: PropertyId) => {
    const row = await readProperty(orgId, pid)
    return row ? { sourceEpoch: row.source_epoch } : null
  },
  isPropertyActive: async (orgId: OrganizationId, pid: PropertyId) =>
    (await readProperty(orgId, pid))?.lifecycle_state === 'active',
  getPublicationScope: async (orgId: OrganizationId, pid: PropertyId) => {
    const row = await readProperty(orgId, pid)
    return row
      ? {
          lifecycleState: row.lifecycle_state as 'active',
          sourceEpoch: row.source_epoch,
        }
      : null
  },
}

/** Review's durable consumers, as its worker registers them. */
function reviewWorkerConsumers() {
  const registry = createConsumerRegistry()
  buildReviewContext({
    publicationActorAuthority: async () => true,
    replyBrandProfiles: { isCurrentAiReplyBrandProfile: async () => true },
    db,
    outboxRepo: createOutboxRepository(db),
    clock: () => ARCHIVED_AT,
    idGen: () => crypto.randomUUID(),
    snapshotRunIdGen: () => crypto.randomUUID(),
    googleReviewApi: {} as never,
    jobQueue: { add: vi.fn() } as unknown as Queue,
    workerRuntime: {
      pool: {} as never,
      registry: { register: vi.fn() },
      backgroundQueue: undefined,
    },
    logger: createMockLogger(),
    staffPublicApi: {} as StaffPublicApi,
    propertyApi,
  }).worker.registerOutboxConsumers(registry)
  return registry
}

/** Commit a lifecycle transition the way the Property command does. */
async function commitLifecycle(
  lifecycleState: 'active' | 'archived',
  sourceEpoch: number,
): Promise<void> {
  await pool.query(
    `UPDATE properties SET lifecycle_state = $2, source_epoch = $3 WHERE id = $1`,
    [PROPERTY, lifecycleState, sourceEpoch],
  )
}

/** Deliver the archive fact (recorded at `sourceEpoch`) to every Review consumer. */
async function deliverArchiveFact(sourceEpoch = 1): Promise<void> {
  const fact = propertyArchived({
    organizationId: ORG,
    propertyId: PROPERTY,
    userId: AUTHOR,
    previousState: 'active',
    sourceEpoch,
    recoveryDeadline: new Date(ARCHIVED_AT.getTime() + 30 * 24 * 60 * 60 * 1000),
    occurredAt: ARCHIVED_AT,
  })
  const row = toOutboxEvent(fact)
  await createOutboxRepository(db).insert({ ...row, id: fact.eventId })
  const event: ConsumerEvent = {
    eventId: fact.eventId,
    eventType: fact._tag,
    eventVersion: 1,
    organizationId: ORG,
    propertyId: PROPERTY,
    sourceContext: 'property',
    sourceAggregateId: PROPERTY,
    occurredAt: ARCHIVED_AT.toISOString(),
    payload: row.payload,
  }
  for (const consumer of reviewWorkerConsumers().listFor(event.eventType)) {
    await consumer.handler(event)
  }
}

/** Commit the archive, then deliver its fact to every Review consumer. */
async function archiveProperty(): Promise<void> {
  await commitLifecycle('archived', 1)
  await deliverArchiveFact(1)
}

/**
 * The publish worker over the production repositories and command store. The
 * Google port records calls only: a claim that reached it would have been
 * refused by the provider authorizer and reported as "Google rejected".
 */
function publishWorker() {
  const googleReviewApi = {
    replyToReview: vi.fn(async () => ({ providerCorrelationId: 'google-1' })),
    getReview: vi.fn(),
  }
  const handler = createPublishReplyHandler({
    replyRepo: createReplyRepository(db, () => ARCHIVED_AT),
    reviewRepo: createReviewRepository(db, () => ARCHIVED_AT),
    googleReviewApi: googleReviewApi as never,
    googleReplyObservationStore: createGoogleReplyObservationStore(db),
    replyCommandStore: createAtomicReplyCommandStore(
      db,
      () => ARCHIVED_AT,
      async () => true,
    ),
    dispatchEvidence: { findDispatchEvidence: vi.fn() } as never,
    clock: () => ARCHIVED_AT,
    logger: createMockLogger(),
    idGen: () => REPLY,
    staffPublicApi: {} as StaffPublicApi,
  })
  return { googleReviewApi, handler }
}

/** The queued job of cycle 1, as approval enqueued it. */
async function publishJob(sourceEpoch = 0) {
  const { rows } = await pool.query<{ source_revision: number }>(
    `SELECT source_revision::int AS source_revision FROM reviews WHERE id = $1`,
    [REVIEW],
  )
  return {
    id: `publish-${REPLY}-1`,
    attemptsMade: 0,
    data: {
      replyId: REPLY,
      organizationId: ORG,
      publicationCycle: 1,
      propertyId: PROPERTY,
      sourceEpoch,
      materialReviewRevision: rows[0]!.source_revision,
      baseObservationRevision: 0,
    },
  } as never
}

async function replyRow() {
  const { rows } = await pool.query(
    `SELECT status, publication_state, publication_cycle::int AS publication_cycle
     FROM replies WHERE id = $1`,
    [REPLY],
  )
  return rows
}

async function replyFacts() {
  const { rows } = await pool.query(
    `SELECT event_type, payload->>'cause' AS cause
     FROM outbox_events
     WHERE organization_id = $1 AND event_type LIKE 'review.reply.%'
     ORDER BY event_type`,
    [ORG],
  )
  return rows
}

const CANCELLED_AS_POLICY = [
  { event_type: 'review.reply.approved', cause: null },
  { event_type: 'review.reply.publication_cancelled', cause: 'policy' },
  { event_type: 'review.reply.publication_requested', cause: null },
]

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 4 })
  clearEventSchemas()
  registerAllEventSchemas()
})

afterAll(async () => {
  await clean()
  clearEventSchemas()
  await pool.end()
})

beforeEach(async () => {
  await clean()
  await seed()
})

describe.sequential('Property archive and reply publication (PostgreSQL)', () => {
  it('cancels an authorized cycle as a policy cancellation, never a publish failure', async () => {
    await authorizeReply()

    await archiveProperty()

    expect(await replyRow()).toEqual([
      { status: 'draft', publication_state: 'cancelled', publication_cycle: 1 },
    ])
    expect(await replyFacts()).toEqual(CANCELLED_AS_POLICY)
  })

  // The archive committed, but its fact has not reached the Review consumer
  // yet when the queued job claims the cycle.
  it('a publish job that claims after the archive commits cancels the cycle and never calls Google', async () => {
    await authorizeReply()
    await commitLifecycle('archived', 1)
    const worker = publishWorker()

    await worker.handler(await publishJob())

    expect(worker.googleReviewApi.replyToReview).not.toHaveBeenCalled()
    expect(await replyRow()).toEqual([
      { status: 'draft', publication_state: 'cancelled', publication_cycle: 1 },
    ])
    expect(await replyFacts()).toEqual(CANCELLED_AS_POLICY)

    // The late archive fact then finds nothing left to cancel.
    await deliverArchiveFact()
    expect(await replyFacts()).toEqual(CANCELLED_AS_POLICY)
  })

  // Archived and restored before either the fact or the job ran: the Property
  // is active again, but at a new source epoch the Review has not been
  // observed at, so the provider authorizer would refuse the old cycle.
  it('a publish job after a quick Restore cancels the pre-archive cycle and never calls Google', async () => {
    await authorizeReply()
    await commitLifecycle('active', 2)
    const worker = publishWorker()

    await worker.handler(await publishJob())

    expect(worker.googleReviewApi.replyToReview).not.toHaveBeenCalled()
    expect(await replyRow()).toEqual([
      { status: 'draft', publication_state: 'cancelled', publication_cycle: 1 },
    ])
    expect(await replyFacts()).toEqual(CANCELLED_AS_POLICY)
  })

  it('an archive fact delivered after a quick Restore still cancels the pre-archive cycle', async () => {
    await authorizeReply()
    await commitLifecycle('active', 2)

    await deliverArchiveFact()

    expect(await replyRow()).toEqual([
      { status: 'draft', publication_state: 'cancelled', publication_cycle: 1 },
    ])
    expect(await replyFacts()).toEqual(CANCELLED_AS_POLICY)
  })

  it('a late archive fact leaves a cycle authorized at the restored epoch alone', async () => {
    await commitLifecycle('active', 2)
    await authorizeReply(2)

    await deliverArchiveFact()

    expect(await replyRow()).toEqual([
      { status: 'approved', publication_state: 'authorized', publication_cycle: 1 },
    ])
    expect(await replyFacts()).toEqual([
      { event_type: 'review.reply.approved', cause: null },
      { event_type: 'review.reply.publication_requested', cause: null },
    ])
  })

  // A claimed write may already be on Google: the worker and the
  // reconciliation sweep own it, and Google may confirm it later.
  it.each(['sending', 'pending_observation'] as const)(
    'archive leaves a %s cycle to the worker',
    async (dispatched) => {
      await authorizeReply()
      await pool.query(`UPDATE replies SET publication_state = $2 WHERE id = $1`, [
        REPLY,
        dispatched,
      ])

      await archiveProperty()

      expect(await replyRow()).toEqual([
        { status: 'approved', publication_state: dispatched, publication_cycle: 1 },
      ])
      expect(await replyFacts()).toEqual([
        { event_type: 'review.reply.approved', cause: null },
        { event_type: 'review.reply.publication_requested', cause: null },
      ])
    },
  )
})
