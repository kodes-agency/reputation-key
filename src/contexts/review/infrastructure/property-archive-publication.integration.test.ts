// Archiving a Property cancels its in-flight reply publications (PostgreSQL).
//
// The provider authorizer refuses a write for a non-active Property, and the
// publish worker reports that refusal as a terminal "Google rejected the
// reply" failure, which sends the author an urgent notice. Archive therefore
// cancels every active publication cycle the way a Google disconnect does:
// publication_state 'cancelled', the Reply back to draft, and one
// `publication_cancelled` (cause 'policy') fact, so the worker's claim finds
// nothing to send and nothing is reported as a rejection.

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

const ORG = organizationId('org-archive-publication-000000000001')
const PROPERTY = propertyId('2c000000-0000-4000-8000-000000000001')
const REVIEW = reviewId('2c000000-0000-4000-8000-000000000010')
const REPLY = replyId('2c000000-0000-4000-8000-000000000020')
const AUTHOR = userId('user-archive-publication-000000001')
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
}

const review = (): Review => ({
  id: REVIEW,
  organizationId: ORG,
  propertyId: PROPERTY,
  platform: 'google',
  externalId: 'ext-archive-publication-1',
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

/** Approve the reply through the production command store: cycle 1, authorized. */
async function authorizeReply(): Promise<void> {
  await createReviewRepository(db, () => NOW).upsert(review())
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
        sourceEpoch: 0,
        materialReviewRevision: 1,
        baseObservationRevision: 0,
        occurredAt: NOW,
      }),
    },
    NOW,
  )
  expect(authorized).toMatchObject({ publicationState: 'authorized' })
}

const isActive = async (orgId: OrganizationId, pid: PropertyId) =>
  (
    await pool.query<{ active: boolean }>(
      `SELECT lifecycle_state = 'active' AS active
       FROM properties WHERE organization_id = $1 AND id = $2`,
      [orgId, pid],
    )
  ).rows[0]?.active === true

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
    propertyApi: {
      getSourceEpoch: async () => ({ sourceEpoch: 1 }),
      isPropertyActive: isActive,
    },
  }).worker.registerOutboxConsumers(registry)
  return registry
}

/** Commit the archive, then deliver its fact to every Review consumer. */
async function archiveProperty(): Promise<void> {
  await pool.query(
    `UPDATE properties SET lifecycle_state = 'archived', source_epoch = 1 WHERE id = $1`,
    [PROPERTY],
  )
  const fact = propertyArchived({
    organizationId: ORG,
    propertyId: PROPERTY,
    userId: AUTHOR,
    previousState: 'active',
    sourceEpoch: 1,
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

    const replies = await pool.query(
      `SELECT status, publication_state, publication_cycle::int AS publication_cycle
       FROM replies WHERE id = $1`,
      [REPLY],
    )
    expect(replies.rows).toEqual([
      { status: 'draft', publication_state: 'cancelled', publication_cycle: 1 },
    ])
    const facts = await pool.query(
      `SELECT event_type, payload->>'cause' AS cause
       FROM outbox_events
       WHERE organization_id = $1 AND event_type LIKE 'review.reply.%'
       ORDER BY event_type`,
      [ORG],
    )
    expect(facts.rows).toEqual([
      { event_type: 'review.reply.approved', cause: null },
      { event_type: 'review.reply.publication_cancelled', cause: 'policy' },
      { event_type: 'review.reply.publication_requested', cause: null },
    ])
  })
})
