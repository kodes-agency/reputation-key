// Fixtures for the Inbox fresh-database replay matrix: source event envelopes,
// seeds for real Review and Guest source truth, consumer dependencies, the
// durable-dispatcher drain, and state capture.

import { emptyLookupPorts } from '#/contexts/reputation/inbox/inbox-test-doubles.test-fixtures'
import { allowAllCommandAuthority } from '#/contexts/reputation/inbox/inbox-test-doubles.test-fixtures'
import { expect } from 'vitest'
import type { Pool } from 'pg'
import { getDb, type Database } from '#/shared/db'
import { releaseDueSlots } from '#/contexts/reputation/response-targets/release-due-slots.test-fixtures'
import { type ConsumerEvent } from '#/shared/outbox'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { createMockLogger } from '#/shared/testing/mock-logger'
import {
  INBOX_REPLAY_CLOCK,
  INBOX_REPLAY_SCOPE,
  INBOX_REPLAY_STATE_KEYS,
  INBOX_REPLAY_STATE_SQL,
  type InboxReplayReviewDelivery,
  type InboxReplayStateKey,
} from '#/shared/testing/inbox-replay-fixtures'
import { createReviewResponseTargetAuthority } from '#/contexts/reputation/reviews/response-target-authority.server'
import { createReviewReplyObservationAuthority } from '#/contexts/reputation/reviews/reply-observation-authority.server'
import { createReviewSourceTransitionAuthority } from '#/contexts/reputation/reviews/source-transition-authority.server'
import { createAtomicInboxCommandStore } from '#/contexts/reputation/inbox/command-store.server'
import { createInboxRepository } from '#/contexts/reputation/inbox/inbox-repository.server'
import { createReviewHandlingCycleStore } from './review-handling-cycle-store.server'
import { createResponseTargetStore } from '../response-targets/store.server'
import {
  handleInboxReplyObserved,
  handleInboxReviewCreated,
  handleInboxReviewSourceTransitioned,
  handleInboxReviewUpdated,
  type InboxConsumerDeps,
} from '#/contexts/reputation/inbox/outbox-consumers.server'
import { type GuestFeedbackConsumerDeps } from './guest-feedback-outbox-consumers.server'
import type { FeedbackLookupPort } from './feedback-lookup.port.server'

export const SCOPE = INBOX_REPLAY_SCOPE
export const AT = INBOX_REPLAY_CLOCK
export const ORG = SCOPE.organizationId

export let pool: Pool

export const bindReplayPool = (replayPool: Pool): void => {
  pool = replayPool
}

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

export const EVENT_IDS = {
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

export type DeliveryName = keyof typeof EVENT_IDS

const reviewScope = {
  reviewId: SCOPE.reviewId as string,
  organizationId: ORG as string,
  propertyId: SCOPE.propertyId as string,
}

const envelope = (
  sourceContext: 'review' | 'guest',
  sourceAggregateId: string,
  eventId: string,
  eventType: string,
  payload: Readonly<Record<string, unknown>>,
): ConsumerEvent => ({
  eventId,
  eventType,
  eventVersion: 1,
  payload,
  organizationId: ORG,
  propertyId: SCOPE.propertyId,
  sourceContext,
  sourceAggregateId,
})

const reviewEnvelope = (
  name: DeliveryName,
  eventType: string,
  payload: Readonly<Record<string, unknown>>,
): ConsumerEvent =>
  envelope('review', SCOPE.reviewId, EVENT_IDS[name], eventType, {
    ...reviewScope,
    ...payload,
  })

const observedPayload = (
  overrides: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> => ({
  sourceEpoch: 0,
  materialReviewRevision: 2,
  matchedReplyId: null,
  matchedPublicationCycle: null,
  occurredAt: AT.replyObservedAt.toISOString(),
  ...overrides,
})

export const REVIEW_ENVELOPES: Readonly<
  Record<InboxReplayReviewDelivery, ConsumerEvent>
> = {
  'review.created': reviewEnvelope('review.created', 'review.created', {
    platform: 'google',
    sourceEpoch: 0,
    sourceRevision: 1,
    analysisSequence: 1,
    occurredAt: AT.reviewObservedRevision1.toISOString(),
  }),
  'review.updated': reviewEnvelope('review.updated', 'review.updated', {
    platform: 'google',
    sourceEpoch: 0,
    sourceRevision: 2,
    analysisSequence: 2,
    occurredAt: AT.reviewObservedRevision2.toISOString(),
  }),
  // Observation revision 1 was true yesterday and is not the current head.
  'reply.observed.staleDeletion': reviewEnvelope(
    'reply.observed.staleDeletion',
    'review.reply.observed',
    observedPayload({
      observationRevision: 1,
      change: 'deleted',
      resolution: 'absent',
      provenance: 'none',
    }),
  ),
  'reply.observed.currentLiveReply': reviewEnvelope(
    'reply.observed.currentLiveReply',
    'review.reply.observed',
    observedPayload({
      observationRevision: 2,
      change: 'added',
      resolution: 'external_current_live',
      provenance: 'external_or_unknown',
    }),
  ),
  // The review is active, so this expiry fact can never be current truth.
  'review.sourceTransitioned': reviewEnvelope(
    'review.sourceTransitioned',
    'review.source_transitioned',
    {
      sourceEpoch: 0,
      sourceRevision: 2,
      analysisSequence: 2,
      change: 'source_expired',
      occurredAt: AT.replyObservedAt.toISOString(),
    },
  ),
}

export const guestEnvelope = (
  name: DeliveryName,
  eventType: string,
  payload: Readonly<Record<string, unknown>>,
): ConsumerEvent =>
  envelope('guest', SCOPE.feedbackId, EVENT_IDS[name], eventType, payload)

export const guestFeedbackPayload = (feedbackSourceId: string) => ({
  feedbackId: feedbackSourceId,
  organizationId: ORG as string,
  propertyId: SCOPE.propertyId as string,
  portalId: SCOPE.portalId as string,
  ratingId: null,
  responseRevision: 1,
  occurredAt: AT.feedbackSubmittedAt.toISOString(),
})

// ── Seeding ──────────────────────────────────────────────────────────

export async function cleanProjection(): Promise<void> {
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

export async function cleanAll(): Promise<void> {
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
export async function seedGuestSourceTruth(): Promise<void> {
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

export async function seedScope(): Promise<void> {
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
export async function seedReviewSourceTruth(): Promise<void> {
  await pool.query(
    `WITH identity AS (
       INSERT INTO reviews (
         id, organization_id, property_id, platform, first_fetched_at,
         source_epoch, source_revision, source_observation_sequence,
         analysis_sequence, source_content_state, created_at, updated_at
       ) VALUES ($1, $2, $3, 'google', $6, 0, 2, 2, 2, 'active', $6, $7)
       RETURNING id
     ) INSERT INTO review_source_contents (
       review_id, organization_id, property_id, platform, external_id,
       external_location_id, rating, reviewed_at, content_expires_at,
       source_created_at, source_updated_at, first_fetched_at, last_fetched_at,
       source_epoch, source_revision, ai_source_byte_length, ai_source_digest
     ) SELECT id, $2, $3, 'google', 'replay-review', 'locations/replay',
       5, $4, $5, $6, $7, $6, $7, 0, 2, 1, $8 FROM identity`,
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

export async function seedSourceEventRows(): Promise<void> {
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

const inboxStores = (feedbackLookup: FeedbackLookupPort) => {
  const database: Database = getDb()
  return {
    commandStore: createAtomicInboxCommandStore(database, allowAllCommandAuthority),
    inboxRepo: createInboxRepository(database, {
      ...emptyLookupPorts,
      feedbackLookup,
    }),
  }
}

function reviewDeps(): InboxConsumerDeps {
  const database: Database = getDb()
  return {
    ...inboxStores(createFeedbackLookup(() => true)),
    handlingCycleStore: createReviewHandlingCycleStore(database),
    replyObservationAuthority: createReviewReplyObservationAuthority(database),
    responseTargetAuthority: createReviewResponseTargetAuthority(database),
    sourceTransitionAuthority: createReviewSourceTransitionAuthority(database),
    idGen: () => SCOPE.reviewItemId,
    clock: () => AT.consumerClock,
    logger: createMockLogger(),
  }
}

export function guestDeps(
  itemId: typeof SCOPE.feedbackItemId,
  available: () => boolean,
): GuestFeedbackConsumerDeps {
  const feedbackLookup = createFeedbackLookup(available)
  return {
    ...inboxStores(feedbackLookup),
    feedbackLookup,
    idGen: () => itemId,
    clock: () => AT.consumerClock,
  }
}

export async function deliverReview(name: InboxReplayReviewDelivery): Promise<void> {
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
export async function drain<Name extends string>(
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

export type ReplayState = Readonly<Record<InboxReplayStateKey, unknown[]>>

export async function captureState(): Promise<ReplayState> {
  const entries = await Promise.all(
    INBOX_REPLAY_STATE_KEYS.map(async (key) => {
      const result = await pool.query(INBOX_REPLAY_STATE_SQL[key], [ORG])
      return [key, result.rows] as const
    }),
  )
  return Object.fromEntries(entries) as ReplayState
}

export const countOutboxRows = async (): Promise<number> =>
  Number(
    (
      await pool.query<{ count: string }>(
        `SELECT count(*) AS count FROM outbox_events
         WHERE organization_id = $1 AND id <> ALL($2::uuid[])`,
        [ORG, Object.values(EVENT_IDS)],
      )
    ).rows[0]!.count,
  )

export const receiptFor = async (eventId: string): Promise<string | null> =>
  (
    await pool.query<{ status: string }>(
      'SELECT status FROM event_consumer_receipts WHERE event_id = $1 LIMIT 1',
      [eventId],
    )
  ).rows[0]?.status ?? null

export async function seedReplayScope(): Promise<void> {
  await cleanAll()
  await seedScope()
  await seedReviewSourceTruth()
  await seedGuestSourceTruth()
  await seedSourceEventRows()
}

/**
 * Replays every named delivery order on a fresh projection and requires the
 * captured state of each to equal the first; returns the state per order.
 */
export async function replayEveryOrder<Name extends string>(
  orders: ReadonlyArray<Readonly<{ deliveries: readonly Name[] }>>,
  deliver: (name: Name) => Promise<void>,
): Promise<ReplayState[]> {
  const observed: ReplayState[] = []
  for (const order of orders) {
    await cleanProjection()
    await drain<Name>(order.deliveries, deliver)
    observed.push(await captureState())
  }
  for (const candidate of observed.slice(1)) {
    expect(candidate).toEqual(observed[0])
  }
  return observed
}

/** However far the clock is advanced, no response target slot is still releasable. */
export const expectNothingReleasable = async (): Promise<void> => {
  await expect(
    releaseDueSlots(createResponseTargetStore(getDb()), {
      now: new Date('2027-01-01T00:00:00.000Z'),
      limit: 100,
    }),
  ).resolves.toEqual({ released: 0 })
}

/** The submission (or the withdrawal of it) as the Guest context delivers it. */
export const submissionEnvelope = (
  feedbackSourceId: string,
  name: DeliveryName = 'guest.feedback.submitted',
): ConsumerEvent =>
  guestEnvelope(name, 'guest.feedback.submitted', guestFeedbackPayload(feedbackSourceId))

export const retractionEnvelope = (feedbackSourceId: string): ConsumerEvent =>
  guestEnvelope('guest.feedback.retracted', 'guest.feedback.retracted', {
    ...guestFeedbackPayload(feedbackSourceId),
    supersedesSourceEventId: EVENT_IDS['guest.feedback.submitted'],
  })
