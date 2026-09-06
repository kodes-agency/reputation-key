// IBX-01-T8 — fresh-database replay matrix.
//
// The Inbox projection is rebuildable by construction: append-only cycles, a
// CAS head, receipt-coordinated applies, and exact-current source authorities.
// "By construction" is a claim, not evidence. This file drops every Inbox row
// for the scope, replays the whole source history in each named delivery order
// from `src/shared/testing/inbox-replay-fixtures.ts`, and requires the
// resulting projection to be identical every time and equal to what current
// source truth implies.
//
// Delivery is modelled the way the durable dispatcher actually behaves: a
// handler that throws is retried on a later pass, a handler that returns
// `obsolete` is finished. That is why an order can start with a fact whose
// subject does not exist yet and still converge.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Pool } from 'pg'
import { getDb, type Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'

import type { ConsumerEvent, ConsumerRegistry } from '#/shared/outbox'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createMockLogger } from '#/shared/testing/mock-logger'
import {
  INBOX_REPLAY_CLOCK,
  INBOX_REPLAY_GUEST_ORDERS,
  INBOX_REPLAY_REVIEW_ORDERS,
  INBOX_REPLAY_SCOPE,
  INBOX_REPLAY_STATE_KEYS,
  INBOX_REPLAY_STATE_SQL,
  INBOX_REPLAY_WITHDRAWAL_ORDERS,
  type InboxReplayGuestDelivery,
  type InboxReplayReviewDelivery,
  type InboxReplayStateKey,
  type InboxReplayWithdrawalDelivery,
} from '#/shared/testing/inbox-replay-fixtures'
import { createReviewResponseTargetAuthority } from '#/contexts/review/infrastructure/response-target-authority'
import { createReviewReplyObservationAuthority } from '#/contexts/review/infrastructure/reply-observation-authority'
import { createReviewSourceTransitionAuthority } from '#/contexts/review/infrastructure/source-transition-authority'
import { readInboxHandlingCutoverScan } from './repositories/inbox-handling-cutover.repository'
import { createReviewResponseTargetAuthorityAdapter } from './adapters/review-response-target-authority.adapter'
import { createReplyObservationAuthorityAdapter } from './adapters/reply-observation-authority.adapter'
import { createSourceTransitionAuthorityAdapter } from './adapters/source-transition-authority.adapter'
import {
  createAtomicInboxCommandStore,
  type InboxCommandAuthority,
} from './inbox-command-store'
import { createInboxRepository } from './repositories/inbox.repository'
import { createReviewHandlingCycleStore } from './review-handling-cycle.store'
import { createFeedbackHandlingStore } from './feedback-handling.store'
import { createResponseTargetStore } from './response-target.store'
import {
  handleInboxReplyObserved,
  handleInboxReviewCreated,
  handleInboxReviewSourceTransitioned,
  handleInboxReviewUpdated,
  type InboxConsumerDeps,
} from './outbox-consumers'
import {
  handleInboxGuestFeedbackRetracted,
  handleInboxGuestFeedbackSubmitted,
  registerGuestFeedbackConsumer,
  type GuestFeedbackConsumerDeps,
} from './guest-feedback-outbox-consumers'
import type { ReviewLookupPort } from '../application/ports/review-lookup.port'
import type { ReviewSourceLookupPort } from '../application/ports/review-source-lookup.port'
import type { FeedbackLookupPort } from '../application/ports/feedback-lookup.port'
import type { PropertyLookupPort } from '../application/ports/property-lookup.port'

const SCOPE = INBOX_REPLAY_SCOPE
const AT = INBOX_REPLAY_CLOCK
const ORG = SCOPE.organizationId

let lease: TestLease
let pool: Pool

const allowAllCommandAuthority: InboxCommandAuthority = async () => ({ allowed: true })

const reviewLookup = {
  getReviewSnippetById: async () => ({ status: 'not_found' as const }),
  getReviewSnippetsByIds: async () => new Map(),
  findEligibleReviewIds: async () => [],
} satisfies ReviewLookupPort

const reviewSourceLookup = {
  getReviewSourceMetaById: async () => null,
  getReviewSourceMetaByIds: async () => [],
  listReviewSources: async () => [],
} satisfies ReviewSourceLookupPort

const propertyLookup = {
  getPropertyNameById: async () => null,
  getPropertyNamesByIds: async () => new Map(),
} satisfies PropertyLookupPort

/** Guest bodies are live-read. `available` flips to false once the source is purged. */
function createFeedbackLookup(available: () => boolean): FeedbackLookupPort {
  return {
    getFeedbackSnippetById: async () =>
      available()
        ? {
            comment: 'Replay private feedback',
            ratingValue: 2,
            responseRevision: 1,
            occurredAt: AT.feedbackSubmittedAt,
          }
        : null,
    getFeedbackSnippetsByIds: async () => new Map(),
    findEligibleFeedbackIds: async () => [],
  } as unknown as FeedbackLookupPort
}

// ── Source event envelopes ───────────────────────────────────────────

const EVENT_IDS = {
  'review.created': '7d000000-0000-4000-8000-000000000101',
  'review.updated': '7d000000-0000-4000-8000-000000000102',
  'reply.observed.staleDeletion': '7d000000-0000-4000-8000-000000000103',
  'reply.observed.currentLiveReply': '7d000000-0000-4000-8000-000000000104',
  'review.sourceTransitioned': '7d000000-0000-4000-8000-000000000105',
  'guest.feedback.submitted': '7d000000-0000-4000-8000-000000000201',
  'guest.rating.submitted.ratingOnlyCorrection': '7d000000-0000-4000-8000-000000000202',
  'guest.feedback.submitted.redelivered': '7d000000-0000-4000-8000-000000000203',
  'guest.feedback.retracted': '7d000000-0000-4000-8000-000000000204',
} as const

type DeliveryName = keyof typeof EVENT_IDS

const reviewScope = {
  reviewId: SCOPE.reviewId as string,
  organizationId: ORG as string,
  propertyId: SCOPE.propertyId as string,
}

const REVIEW_ENVELOPES: Readonly<Record<InboxReplayReviewDelivery, ConsumerEvent>> = {
  'review.created': {
    eventId: EVENT_IDS['review.created'],
    eventType: 'review.created',
    eventVersion: 1,
    payload: {
      ...reviewScope,
      platform: 'google',
      sourceEpoch: 0,
      sourceRevision: 1,
      analysisSequence: 1,
      occurredAt: AT.reviewObservedRevision1.toISOString(),
    },
    organizationId: ORG,
    propertyId: SCOPE.propertyId,
    sourceContext: 'review',
    sourceAggregateId: SCOPE.reviewId,
  },
  'review.updated': {
    eventId: EVENT_IDS['review.updated'],
    eventType: 'review.updated',
    eventVersion: 1,
    payload: {
      ...reviewScope,
      platform: 'google',
      sourceEpoch: 0,
      sourceRevision: 2,
      analysisSequence: 2,
      occurredAt: AT.reviewObservedRevision2.toISOString(),
    },
    organizationId: ORG,
    propertyId: SCOPE.propertyId,
    sourceContext: 'review',
    sourceAggregateId: SCOPE.reviewId,
  },
  // Observation revision 1 was true yesterday and is not the current head.
  'reply.observed.staleDeletion': {
    eventId: EVENT_IDS['reply.observed.staleDeletion'],
    eventType: 'review.reply.observed',
    eventVersion: 1,
    payload: {
      ...reviewScope,
      observationRevision: 1,
      sourceEpoch: 0,
      materialReviewRevision: 2,
      change: 'deleted',
      resolution: 'absent',
      provenance: 'none',
      matchedReplyId: null,
      matchedPublicationCycle: null,
      occurredAt: AT.replyObservedAt.toISOString(),
    },
    organizationId: ORG,
    propertyId: SCOPE.propertyId,
    sourceContext: 'review',
    sourceAggregateId: SCOPE.reviewId,
  },
  'reply.observed.currentLiveReply': {
    eventId: EVENT_IDS['reply.observed.currentLiveReply'],
    eventType: 'review.reply.observed',
    eventVersion: 1,
    payload: {
      ...reviewScope,
      observationRevision: 2,
      sourceEpoch: 0,
      materialReviewRevision: 2,
      change: 'added',
      resolution: 'external_current_live',
      provenance: 'external_or_unknown',
      matchedReplyId: null,
      matchedPublicationCycle: null,
      occurredAt: AT.replyObservedAt.toISOString(),
    },
    organizationId: ORG,
    propertyId: SCOPE.propertyId,
    sourceContext: 'review',
    sourceAggregateId: SCOPE.reviewId,
  },
  // The review is active, so this expiry fact can never be current truth.
  'review.sourceTransitioned': {
    eventId: EVENT_IDS['review.sourceTransitioned'],
    eventType: 'review.source_transitioned',
    eventVersion: 1,
    payload: {
      ...reviewScope,
      sourceEpoch: 0,
      sourceRevision: 2,
      analysisSequence: 2,
      change: 'source_expired',
      occurredAt: AT.replyObservedAt.toISOString(),
    },
    organizationId: ORG,
    propertyId: SCOPE.propertyId,
    sourceContext: 'review',
    sourceAggregateId: SCOPE.reviewId,
  },
}

const guestEnvelope = (
  name: DeliveryName,
  eventType: string,
  payload: Readonly<Record<string, unknown>>,
): ConsumerEvent => ({
  eventId: EVENT_IDS[name],
  eventType,
  eventVersion: 1,
  payload,
  organizationId: ORG,
  propertyId: SCOPE.propertyId,
  sourceContext: 'guest',
  sourceAggregateId: SCOPE.feedbackId,
})

const guestFeedbackPayload = (feedbackSourceId: string) => ({
  feedbackId: feedbackSourceId,
  organizationId: ORG as string,
  propertyId: SCOPE.propertyId as string,
  portalId: SCOPE.portalId as string,
  ratingId: null,
  responseRevision: 1,
  occurredAt: AT.feedbackSubmittedAt.toISOString(),
})

// ── Seeding ──────────────────────────────────────────────────────────

async function cleanProjection(): Promise<void> {
  await pool.query(
    `DELETE FROM event_consumer_receipts
     WHERE event_id = ANY($1::uuid[])`,
    [Object.values(EVENT_IDS)],
  )
  await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORG])
  await pool.query(
    `DELETE FROM outbox_events
     WHERE organization_id = $1 AND id <> ALL($2::uuid[])`,
    [ORG, Object.values(EVENT_IDS)],
  )
}

async function cleanAll(): Promise<void> {
  await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORG])
  await pool.query(
    `DELETE FROM event_consumer_receipts WHERE event_id = ANY($1::uuid[])`,
    [Object.values(EVENT_IDS)],
  )
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG])
  await pool.query(
    'DELETE FROM google_reply_observation_heads WHERE organization_id = $1',
    [ORG],
  )
  await pool.query('DELETE FROM google_reply_observations WHERE organization_id = $1', [
    ORG,
  ])
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM guest_responses WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM portals WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await deleteTestOrganizations(pool, [ORG])
}

/**
 * Real Guest source rows, not stubs. The cutover classifier resolves a private
 * feedback anchor from `guest_responses`; without it every replayed feedback
 * row would classify as `orphan` and the zero-orphan assertion would be
 * meaningless.
 */
async function seedGuestSourceTruth(): Promise<void> {
  await pool.query(
    `INSERT INTO portals (
       id, organization_id, property_id, entity_type, entity_id, name, slug,
       publication_state, created_at, updated_at
     ) VALUES ($1, $2, $3, 'property', $4, 'Replay portal', $5, 'published', $6, $6)`,
    [
      SCOPE.portalId,
      ORG,
      SCOPE.propertyId,
      SCOPE.propertyId as string,
      `replay-portal-${process.pid}`,
      AT.feedbackSubmittedAt,
    ],
  )
  await pool.query(
    `INSERT INTO guest_responses (
       id, organization_id, property_id, portal_id, status, rating,
       response_consent, text_consent, media_consent, submitted_at,
       retention_deadline, feedback_submitted_at, feedback_submission_revision,
       created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'submitted', 2, true, true, false, $5, $6, $5, 1, $5, $5)`,
    [
      SCOPE.feedbackId,
      ORG,
      SCOPE.propertyId,
      SCOPE.portalId,
      AT.feedbackSubmittedAt,
      new Date('2027-08-01T00:00:00.000Z'),
    ],
  )
}

async function seedScope(): Promise<void> {
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Inbox replay matrix', $2, NOW())`,
    [ORG, `inbox-replay-matrix-${process.pid}`],
  )
  await pool.query(
    `INSERT INTO properties (
       id, organization_id, name, slug, timezone, source_epoch, created_at, updated_at
     ) VALUES ($1, $2, 'Replay property', $3, 'UTC', 0, NOW(), NOW())`,
    [SCOPE.propertyId, ORG, `inbox-replay-matrix-${process.pid}`],
  )
}

/** Final Review truth: active, material revision 2, current reply confirmed. */
async function seedReviewSourceTruth(): Promise<void> {
  await pool.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id,
       external_location_id, rating, reviewed_at, expires_at,
       source_created_at, source_updated_at, first_fetched_at, last_fetched_at,
       content_expires_at, source_epoch, source_revision,
       source_observation_sequence, analysis_sequence, ai_source_byte_length,
       ai_source_digest, source_content_state, created_at, updated_at
     ) VALUES (
       $1, $2, $3, 'google', 'replay-review', 'locations/replay', 5, $4, $5,
       $6, $7, $6, $7, $5, 0, 2, 2, 2, 1, $8, 'active', $6, $7
     )`,
    [
      SCOPE.reviewId,
      ORG,
      SCOPE.propertyId,
      AT.targetStartRevision1,
      new Date('2027-08-01T12:00:00.000Z'),
      AT.reviewObservedRevision1,
      AT.reviewObservedRevision2,
      'a'.repeat(64),
    ],
  )
  const revisions = [
    {
      revision: 1,
      observedAt: AT.reviewObservedRevision1,
      start: AT.targetStartRevision1,
    },
    {
      revision: 2,
      observedAt: AT.reviewObservedRevision2,
      start: AT.targetStartRevision2,
    },
  ] as const
  for (const revision of revisions) {
    await pool.query(
      `INSERT INTO material_review_revisions (
         review_id, revision, organization_id, property_id, source_epoch,
         normalization_version, source_digest, normalized_digest, rating,
         normalized_text, response_target_eligibility, response_target_start_at,
         content_state, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, 0, 'review-material-v1', $5, $5, 4,
         $6, 'measured', $7, 'active', $8, $8
       )`,
      [
        SCOPE.reviewId,
        revision.revision,
        ORG,
        SCOPE.propertyId,
        String(revision.revision).repeat(64).slice(0, 64),
        `replay-revision-${revision.revision}`,
        revision.start,
        revision.observedAt,
      ],
    )
  }
  // Observation revision 1 (deleted) is superseded by revision 2 (confirmed).
  const observations = [
    {
      revision: 1,
      state: 'absent',
      change: 'deleted',
      resolution: 'absent',
      provenance: 'none',
    },
    {
      revision: 2,
      state: 'live',
      change: 'added',
      resolution: 'external_current_live',
      provenance: 'external_or_unknown',
    },
  ] as const
  let currentObservationId: string | null = null
  for (const observation of observations) {
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO google_reply_observations (
         organization_id, property_id, review_id, observation_revision,
         observation_key, input_digest, source_epoch, material_review_revision,
         read_generation, state, change, resolution, source, provenance,
         normalized_text, normalization_version, normalized_digest, observed_at,
         content_expires_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, 0, 2, $4, $7, $8, $9,
         'provider_snapshot', $10, $11, 'google-reply-v1', $12, $13, $14
       ) RETURNING id`,
      [
        ORG,
        SCOPE.propertyId,
        SCOPE.reviewId,
        observation.revision,
        String(observation.revision).repeat(64).slice(0, 64),
        String(observation.revision + 3)
          .repeat(64)
          .slice(0, 64),
        observation.state,
        observation.change,
        observation.resolution,
        observation.provenance,
        observation.state === 'live' ? `replay-reply-${observation.revision}` : null,
        observation.state === 'live'
          ? String(observation.revision + 6)
              .repeat(64)
              .slice(0, 64)
          : null,
        AT.replyObservedAt,
        new Date('2027-08-01T12:00:00.000Z'),
      ],
    )
    currentObservationId = inserted.rows[0]!.id
  }
  await pool.query(
    `INSERT INTO google_reply_observation_heads (
       review_id, organization_id, property_id, observation_id,
       observation_revision, source_epoch, material_review_revision,
       state, provenance, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 2, 0, 2, 'live', 'external_or_unknown', $5, $5)`,
    [SCOPE.reviewId, ORG, SCOPE.propertyId, currentObservationId, AT.replyObservedAt],
  )
}

async function seedSourceEventRows(): Promise<void> {
  const rows: ReadonlyArray<Readonly<{ name: DeliveryName; type: string }>> = [
    { name: 'review.created', type: 'review.created' },
    { name: 'review.updated', type: 'review.updated' },
    { name: 'reply.observed.staleDeletion', type: 'review.reply.observed' },
    { name: 'reply.observed.currentLiveReply', type: 'review.reply.observed' },
    { name: 'review.sourceTransitioned', type: 'review.source_transitioned' },
    { name: 'guest.feedback.submitted', type: 'guest.feedback.submitted' },
    {
      name: 'guest.rating.submitted.ratingOnlyCorrection',
      type: 'guest.rating.submitted',
    },
    { name: 'guest.feedback.submitted.redelivered', type: 'guest.feedback.submitted' },
    { name: 'guest.feedback.retracted', type: 'guest.feedback.retracted' },
  ]
  for (const row of rows) {
    await pool.query(
      `INSERT INTO outbox_events (
         id, event_type, event_version, payload, organization_id,
         property_id, source_context, source_aggregate_id, created_at
       ) VALUES ($1, $2, 1, '{}'::jsonb, $3, $4, 'review', $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [
        EVENT_IDS[row.name],
        row.type,
        ORG,
        SCOPE.propertyId,
        SCOPE.reviewId,
        AT.reviewObservedRevision1,
      ],
    )
  }
}

// ── Delivery ─────────────────────────────────────────────────────────

function reviewDeps(): InboxConsumerDeps {
  const database: Database = getDb()
  return {
    commandStore: createAtomicInboxCommandStore(
      database,
      allowAllCommandAuthority,
      () => AT.consumerClock,
    ),
    handlingCycleStore: createReviewHandlingCycleStore(database),
    replyObservationAuthority: createReplyObservationAuthorityAdapter(
      createReviewReplyObservationAuthority(database),
    ),
    responseTargetAuthority: createReviewResponseTargetAuthorityAdapter(
      createReviewResponseTargetAuthority(database),
    ),
    sourceTransitionAuthority: createSourceTransitionAuthorityAdapter(
      createReviewSourceTransitionAuthority(database),
    ),
    reviewLookup,
    reviewSourceLookup,
    inboxRepo: createInboxRepository(
      database,
      { reviewLookup, feedbackLookup: createFeedbackLookup(() => true), propertyLookup },
      { clock: () => AT.consumerClock, logger: createMockLogger() },
    ),
    idGen: () => SCOPE.reviewItemId,
    clock: () => AT.consumerClock,
    logger: createMockLogger(),
  }
}

function guestDeps(
  itemId: typeof SCOPE.feedbackItemId,
  available: () => boolean,
): GuestFeedbackConsumerDeps {
  const database: Database = getDb()
  const feedbackLookup = createFeedbackLookup(available)
  return {
    commandStore: createAtomicInboxCommandStore(
      database,
      allowAllCommandAuthority,
      () => AT.consumerClock,
    ),
    feedbackLookup,
    inboxRepo: createInboxRepository(
      database,
      { reviewLookup, feedbackLookup, propertyLookup },
      { clock: () => AT.consumerClock, logger: createMockLogger() },
    ),
    idGen: () => itemId,
    clock: () => AT.consumerClock,
  }
}

async function deliverReview(name: InboxReplayReviewDelivery): Promise<void> {
  const deps = reviewDeps()
  const envelope = REVIEW_ENVELOPES[name]
  if (name === 'review.created') {
    await handleInboxReviewCreated(deps, envelope)
    return
  }
  if (name === 'review.updated') {
    await handleInboxReviewUpdated(deps, envelope)
    return
  }
  if (name === 'review.sourceTransitioned') {
    await handleInboxReviewSourceTransitioned(deps, envelope)
    return
  }
  await handleInboxReplyObserved(deps, envelope)
}

/**
 * One durable dispatcher pass set. A throwing handler is retryable (the
 * dispatcher redelivers); an `obsolete` result is terminal. Every delivery is
 * offered twice per pass so at-least-once redelivery is exercised inline.
 */
async function drain<Name extends string>(
  deliveries: readonly Name[],
  deliver: (name: Name) => Promise<void>,
): Promise<void> {
  let pending = [...deliveries]
  for (let pass = 0; pass <= deliveries.length && pending.length > 0; pass += 1) {
    const retry: Name[] = []
    for (const name of pending) {
      try {
        await deliver(name)
        await deliver(name)
      } catch {
        retry.push(name)
      }
    }
    pending = retry
  }
  if (pending.length > 0) {
    throw new Error(`Replay never converged; still pending: ${pending.join(', ')}`)
  }
}

// ── State capture ────────────────────────────────────────────────────

type ReplayState = Readonly<Record<InboxReplayStateKey, unknown[]>>

async function captureState(): Promise<ReplayState> {
  const entries = await Promise.all(
    INBOX_REPLAY_STATE_KEYS.map(async (key) => {
      const result = await pool.query(INBOX_REPLAY_STATE_SQL[key], [ORG])
      return [key, result.rows] as const
    }),
  )
  return Object.fromEntries(entries) as ReplayState
}

const countOutboxRows = async (): Promise<number> =>
  Number(
    (
      await pool.query<{ count: string }>(
        `SELECT count(*) AS count FROM outbox_events
         WHERE organization_id = $1 AND id <> ALL($2::uuid[])`,
        [ORG, Object.values(EVENT_IDS)],
      )
    ).rows[0]!.count,
  )

const receiptFor = async (eventId: string): Promise<string | null> =>
  (
    await pool.query<{ status: string }>(
      'SELECT status FROM event_consumer_receipts WHERE event_id = $1 LIMIT 1',
      [eventId],
    )
  ).rows[0]?.status ?? null

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 4)
  pool = lease.pool
  clearEventSchemas()
  registerAllEventSchemas()
})

afterAll(async () => {
  await cleanAll()
  clearEventSchemas()
  await lease.release()
})

beforeEach(async () => {
  await cleanAll()
  await seedScope()
  await seedReviewSourceTruth()
  await seedGuestSourceTruth()
  await seedSourceEventRows()
})

describe.sequential('Inbox fresh-database replay matrix (PostgreSQL)', () => {
  it('rebuilds one identical Review projection for every named delivery order', async () => {
    const observed: Array<{ order: string; state: ReplayState }> = []
    for (const order of INBOX_REPLAY_REVIEW_ORDERS) {
      await cleanProjection()
      await drain<InboxReplayReviewDelivery>(order.deliveries, deliverReview)
      observed.push({ order: order.name, state: await captureState() })
    }

    expect(observed).toHaveLength(INBOX_REPLAY_REVIEW_ORDERS.length)
    for (const candidate of observed.slice(1)) {
      expect({ order: 'in_order', state: candidate.state }).toEqual({
        order: 'in_order',
        state: observed[0]!.state,
      })
    }

    // Current source truth: two Material Review Revisions, the second closed by
    // a confirmed provider reply. Both stale facts are absorbed as obsolete.
    const converged = observed[0]!.state
    expect(converged.items).toEqual([
      expect.objectContaining({ id: SCOPE.reviewItemId as string, status: 'closed' }),
    ])
    expect(converged.heads).toEqual([
      expect.objectContaining({
        current_cycle_number: 2,
        current_source_revision: 2,
        status: 'closed',
      }),
    ])
    expect(
      converged.cycles.map((row) => (row as { cycle_number: number }).cycle_number),
    ).toEqual([1, 2])
    expect(
      converged.transitions.map(
        (row) => (row as { transition_reason: string }).transition_reason,
      ),
    ).toEqual([
      'review_observed',
      'superseded_by_source_revision',
      'material_revision_changed',
      'external_reply_observed',
    ])
    expect(
      converged.responseTargets.map((row) => (row as { result: string | null }).result),
    ).toEqual(['cancelled', 'on_time'])
    expect(await receiptFor(EVENT_IDS['reply.observed.staleDeletion'])).toBe('obsolete')
    expect(await receiptFor(EVENT_IDS['review.sourceTransitioned'])).toBe('obsolete')

    // `inbox_items.status` is a compatibility mirror of the head, so a replay
    // that produced a different mirror value would be a silent divergence for
    // every context still reading the column.
    const divergent = await pool.query(
      `SELECT item.id
       FROM inbox_items AS item
       JOIN inbox_handling_cycle_heads AS head ON head.inbox_item_id = item.id
       WHERE item.organization_id = $1 AND item.status <> head.status`,
      [ORG],
    )
    expect(divergent.rows).toEqual([])
  })

  it('creates exactly one halfway and one target-passed slot per measured cycle and leaves none releasable', async () => {
    await cleanProjection()
    await drain<InboxReplayReviewDelivery>(
      INBOX_REPLAY_REVIEW_ORDERS[0]!.deliveries,
      deliverReview,
    )

    const state = await captureState()
    const perCycle = new Map<number, string[]>()
    for (const row of state.reminders as ReadonlyArray<
      Readonly<{ cycle_number: number; reminder_kind: string }>
    >) {
      perCycle.set(row.cycle_number, [
        ...(perCycle.get(row.cycle_number) ?? []),
        row.reminder_kind,
      ])
    }
    expect([...perCycle.entries()].sort()).toEqual([
      [1, ['halfway', 'target_passed']],
      [2, ['halfway', 'target_passed']],
    ])

    // Cycle 1 was superseded and cycle 2 closed on a confirmed reply, so no
    // slot may still be releasable however far the clock is advanced.
    await expect(
      createResponseTargetStore(getDb()).releaseDueReminders({
        now: new Date('2027-01-01T00:00:00.000Z'),
        limit: 100,
      }),
    ).resolves.toEqual({ released: 0 })
  })

  it('absorbs an identical second replay of the whole Review history as a no-op', async () => {
    await cleanProjection()
    await drain<InboxReplayReviewDelivery>(
      INBOX_REPLAY_REVIEW_ORDERS[0]!.deliveries,
      deliverReview,
    )
    const before = await captureState()
    const outboxBefore = await countOutboxRows()

    await drain<InboxReplayReviewDelivery>(
      INBOX_REPLAY_REVIEW_ORDERS[0]!.deliveries,
      deliverReview,
    )

    expect(await captureState()).toEqual(before)
    expect(await countOutboxRows()).toBe(outboxBefore)
  })

  it('leaves no receipt for an observation that overtakes its projection and converges once the item exists', async () => {
    await cleanProjection()

    await expect(deliverReview('reply.observed.currentLiveReply')).rejects.toMatchObject({
      _tag: 'InboxError',
    })
    expect(await receiptFor(EVENT_IDS['reply.observed.currentLiveReply'])).toBeNull()

    await deliverReview('review.created')
    await deliverReview('review.updated')
    await deliverReview('reply.observed.currentLiveReply')

    expect(await receiptFor(EVENT_IDS['reply.observed.currentLiveReply'])).toBe('applied')
    const state = await captureState()
    expect(state.heads).toEqual([
      expect.objectContaining({ current_cycle_number: 2, status: 'closed' }),
    ])
  })

  it('rebuilds one identical private-feedback projection for every named Guest order', async () => {
    const deliverGuest = async (name: InboxReplayGuestDelivery): Promise<void> => {
      if (name === 'guest.rating.submitted.ratingOnlyCorrection') {
        // Inbox registers no consumer for a rating-only correction; delivering
        // it is a structural assertion, not a projection command.
        return
      }
      const eventName: DeliveryName =
        name === 'guest.feedback.submitted.redelivered'
          ? 'guest.feedback.submitted.redelivered'
          : 'guest.feedback.submitted'
      await handleInboxGuestFeedbackSubmitted(
        guestDeps(SCOPE.feedbackItemId, () => true),
        guestEnvelope(
          eventName,
          'guest.feedback.submitted',
          guestFeedbackPayload(SCOPE.feedbackId),
        ),
      )
    }

    const registered: string[] = []
    const registry = {
      registerConsumer: (registration: Readonly<{ eventType: string }>) => {
        registered.push(registration.eventType)
      },
    } as unknown as ConsumerRegistry
    registerGuestFeedbackConsumer(
      registry,
      guestDeps(SCOPE.feedbackItemId, () => true),
    )
    expect(registered).toEqual(['guest.feedback.submitted', 'guest.feedback.retracted'])

    const observed: ReplayState[] = []
    for (const order of INBOX_REPLAY_GUEST_ORDERS) {
      await cleanProjection()
      await drain<InboxReplayGuestDelivery>(order.deliveries, deliverGuest)
      observed.push(await captureState())
    }
    for (const candidate of observed.slice(1)) {
      expect(candidate).toEqual(observed[0])
    }

    // Exactly one Inbox Item, one cycle, one target — the rating-only
    // correction and the redelivery add nothing.
    const converged = observed[0]!
    expect(converged.items).toHaveLength(1)
    expect(converged.cycles).toHaveLength(1)
    expect(converged.responseTargets).toHaveLength(1)
    expect(converged.outcomes).toEqual([])
  })

  it('never resurrects a purged private-feedback projection in any Guest withdrawal order', async () => {
    const deliverWithdrawal = async (
      name: InboxReplayWithdrawalDelivery,
    ): Promise<void> => {
      if (name === 'guest.rating.submitted.ratingOnlyCorrection') return
      // Current Guest truth for this feedback is "the body is gone".
      const deps = guestDeps(SCOPE.withdrawnFeedbackItemId, () => false)
      if (name === 'guest.feedback.submitted') {
        await handleInboxGuestFeedbackSubmitted(
          deps,
          guestEnvelope(
            'guest.feedback.submitted',
            'guest.feedback.submitted',
            guestFeedbackPayload(SCOPE.withdrawnFeedbackId),
          ),
        )
        return
      }
      await handleInboxGuestFeedbackRetracted(
        deps,
        guestEnvelope('guest.feedback.retracted', 'guest.feedback.retracted', {
          ...guestFeedbackPayload(SCOPE.withdrawnFeedbackId),
          supersedesSourceEventId: EVENT_IDS['guest.feedback.submitted'],
        }),
      )
    }

    const observed: ReplayState[] = []
    for (const order of INBOX_REPLAY_WITHDRAWAL_ORDERS) {
      await cleanProjection()
      await drain<InboxReplayWithdrawalDelivery>(order.deliveries, deliverWithdrawal)
      observed.push(await captureState())
    }
    for (const candidate of observed.slice(1)) {
      expect(candidate).toEqual(observed[0])
    }
    expect(observed[0]!.items).toEqual([])
    expect(observed[0]!.cycles).toEqual([])
    expect(observed[0]!.outcomes).toEqual([])
    expect(await receiptFor(EVENT_IDS['guest.feedback.submitted'])).toBe('obsolete')
  })

  it('closes a live private-feedback cycle on withdrawal and leaves no releasable slot or manager outcome', async () => {
    await cleanProjection()
    let bodyAvailable = true
    await handleInboxGuestFeedbackSubmitted(
      guestDeps(SCOPE.feedbackItemId, () => bodyAvailable),
      guestEnvelope(
        'guest.feedback.submitted',
        'guest.feedback.submitted',
        guestFeedbackPayload(SCOPE.feedbackId),
      ),
    )
    bodyAvailable = false
    await handleInboxGuestFeedbackRetracted(
      guestDeps(SCOPE.feedbackItemId, () => bodyAvailable),
      guestEnvelope('guest.feedback.retracted', 'guest.feedback.retracted', {
        ...guestFeedbackPayload(SCOPE.feedbackId),
        supersedesSourceEventId: EVENT_IDS['guest.feedback.submitted'],
      }),
    )

    const state = await captureState()
    expect(state.heads).toEqual([
      expect.objectContaining({ current_cycle_number: 1, status: 'closed' }),
    ])
    expect(
      state.transitions.map(
        (row) => (row as { transition_reason: string }).transition_reason,
      ),
    ).toEqual(['feedback_submitted', 'guest_withdrawn'])
    expect(
      state.reminders.map(
        (row) => (row as { cancelled_at: Date | null }).cancelled_at !== null,
      ),
    ).toEqual([true, true])
    expect(state.outcomes).toEqual([])
    await expect(
      createResponseTargetStore(getDb()).releaseDueReminders({
        now: new Date('2027-01-01T00:00:00.000Z'),
        limit: 100,
      }),
    ).resolves.toEqual({ released: 0 })
    await expect(
      createFeedbackHandlingStore(getDb(), allowAllCommandAuthority).getState(
        SCOPE.feedbackItemId,
        ORG,
      ),
    ).resolves.toMatchObject({ closeReason: 'guest_withdrawn', currentOutcome: null })
  })

  it('classifies every freshly replayed row as exact — no ambiguous, no orphan', async () => {
    await cleanProjection()
    await drain<InboxReplayReviewDelivery>(
      INBOX_REPLAY_REVIEW_ORDERS[0]!.deliveries,
      deliverReview,
    )
    await handleInboxGuestFeedbackSubmitted(
      guestDeps(SCOPE.feedbackItemId, () => true),
      guestEnvelope(
        'guest.feedback.submitted',
        'guest.feedback.submitted',
        guestFeedbackPayload(SCOPE.feedbackId),
      ),
    )

    const scan = await readInboxHandlingCutoverScan(getDb(), {
      organizationId: ORG,
      observedAt: AT.observedAt,
    })
    expect(scan.totals).toMatchObject({ ambiguous: 0, orphan: 0 })
    expect(scan.totals.total).toBe(scan.totals.exact + scan.totals.mappable)
    expect(scan.totals.total).toBeGreaterThan(0)
  })
})
