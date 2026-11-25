import { reviewOpeningAnchor } from './review-opening-anchor.test-fixtures'
import { openNextReviewCycleForTest } from '#/contexts/reputation/inbox/review-cycle-reopen.test-fixtures'
import { afterAll, beforeAll, beforeEach, expect, vi } from 'vitest'
import type { Pool } from 'pg'
import { getDb, type Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem } from '#/contexts/reputation/domain/inbox-types'
import { inboxItemStatusChanged } from '#/contexts/reputation/domain/inbox-events'
import {
  createAtomicInboxCommandStore as createProductionInboxCommandStore,
  type InboxCommandAuthority,
} from '#/contexts/reputation/inbox/command-store.server'
import { createInboxRepository } from '#/contexts/reputation/inbox/inbox-repository.server'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createReviewReplyObservationAuthority } from '#/contexts/reputation/reviews/reply-observation-authority.server'
import { createReviewSourceTransitionAuthority } from '#/contexts/reputation/reviews/source-transition-authority.server'
import { createGoogleReplyObservationStore } from '#/contexts/reputation/publication/google-reply-observation-store.server'
import type { CurrentReplyObservationPermit } from '#/contexts/reputation/inbox/review-reply-observation-authority.port.server'
import type { InboxConsumerDeps } from '#/contexts/reputation/inbox/outbox-consumers.server'
import { createReviewHandlingCycleStore } from '#/contexts/reputation/inbox/review-handling-cycle-store.server'
import type { ConsumerEvent } from '#/shared/outbox'
import type { ReviewLookupPort } from '#/contexts/reputation/inbox/review-lookup.port.server'
import type { FeedbackLookupPort } from '#/contexts/reputation/inbox/feedback-lookup.port.server'
import type { PropertyLookupPort } from '#/contexts/reputation/inbox/property-lookup.port.server'
import { createMockLogger } from '#/shared/testing/mock-logger'

export const ORG = organizationId('org-inbox-reply-observation')
export const PROPERTY = propertyId('b2000000-0000-0000-0000-000000000001')
export const REVIEW = reviewId('b2000000-0000-0000-0000-000000000010')
export const ITEM = inboxItemId('b2000000-0000-0000-0000-000000000020')
export const MANUAL_REOPEN_ACTOR = userId('user-inbox-reply-observation-manager')
export const OPENED_AT = new Date('2026-08-20T10:00:00.000Z')
export const OBSERVED_AT = new Date('2026-08-20T12:00:00.000Z')
export const EXPIRES_AT = new Date('2026-09-20T12:00:00.000Z')
export const EVENT_LIVE = 'b2000000-0000-0000-0000-000000000101'
export const EVENT_DELETED = 'b2000000-0000-0000-0000-000000000102'
export const EVENT_EXTERNAL_EDITED = 'b2000000-0000-0000-0000-000000000103'

export const responseTargetPermit = (materialReviewRevision: number) => ({
  reviewAuthority: {
    authority: 'review.current-response-target.v1' as const,
    organizationId: ORG,
    propertyId: PROPERTY,
    reviewId: REVIEW,
    sourceEpoch: 0,
    materialReviewRevision,
    eligibility: 'legacy_unknown' as const,
    responseTargetStartAt: null,
    rating: null,
  },
  targetStart: { basis: 'review_provenance' as const },
})

export const measuredResponseTargetPermit = (startAt: Date = OPENED_AT) => ({
  reviewAuthority: {
    authority: 'review.current-response-target.v1' as const,
    organizationId: ORG,
    propertyId: PROPERTY,
    reviewId: REVIEW,
    sourceEpoch: 0,
    materialReviewRevision: 1,
    eligibility: 'measured' as const,
    responseTargetStartAt: startAt,
    rating: null,
  },
  targetStart: { basis: 'review_provenance' as const },
})

const allowAllCommandAuthority: InboxCommandAuthority = async () => ({
  allowed: true,
})
export const logger = createMockLogger()

export const createAtomicInboxCommandStore = (database: Database) =>
  createProductionInboxCommandStore(database, allowAllCommandAuthority, () => OBSERVED_AT)
export const EVENT_STALE = 'b2000000-0000-0000-0000-000000000104'
export const EVENT_AHEAD = 'b2000000-0000-0000-0000-000000000105'
export const EVENT_OLDER = 'b2000000-0000-0000-0000-000000000106'
export const EVENT_REVIEW_ADVANCED = 'b2000000-0000-0000-0000-000000000107'
export const EVENT_LEGACY_DIVERGED = 'b2000000-0000-0000-0000-000000000108'
export const EVENT_LOCK_ORDER = 'b2000000-0000-0000-0000-000000000109'
export const EVENT_INACTIVE_DELETED = 'b2000000-0000-0000-0000-000000000110'
export const EVENT_EPOCH_CARRY = 'b2000000-0000-0000-0000-000000000111'
export const EVENT_EPOCH_MATERIAL_CHANGE = 'b2000000-0000-0000-0000-000000000112'

let pool: Pool

export function makeItem(): InboxItem {
  return {
    id: ITEM,
    organizationId: ORG,
    propertyId: PROPERTY,
    sourceType: 'review',
    sourceId: REVIEW,
    status: 'open',
    rating: 5,
    sourceDate: OPENED_AT,
    platform: 'google',
    snippet: null,
    assignedTo: null,
    reviewerName: null,
    propertyName: null,
    isEscalated: false,
    escalatedAt: null,
    escalatedBy: null,
    escalationResolvedAt: null,
    escalationResolvedBy: null,
    closedAt: null,
    firstReplySubmittedAt: null,
    firstReplyPublishedAt: null,
    commandRevision: 1,
    createdAt: OPENED_AT,
    updatedAt: OPENED_AT,
  }
}

export async function clean(): Promise<void> {
  await pool.query(
    'TRUNCATE google_reply_observation_heads, google_reply_observations, reply_publication_attempts CASCADE',
  )
  await pool.query('DELETE FROM event_consumer_receipts WHERE consumer_name = $1', [
    'inbox.on-reply-observed',
  ])
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORG])
  await pool.query(
    'DELETE FROM inbox_response_target_organization_policies WHERE organization_id = $1',
    [ORG],
  )
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await deleteTestOrganizations(pool, [ORG])
}

/**
 * `measured` gives the cycle a 48 hour Google-review Response Target (halfway
 * and target-passed reminder slots) timed from OPENED_AT, as a live review has.
 */
export async function seed(
  options: Readonly<{
    measured?: boolean
    /** Organization policy for the Google-review target; the built-in default is 48 hours. */
    targetMinutes?: number
    /** When Google says the review was created, the target's start. Defaults to OPENED_AT. */
    sourceCreatedAt?: Date
  }> = {},
): Promise<InboxItem> {
  const sourceCreatedAt = options.sourceCreatedAt ?? OPENED_AT
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Inbox Reply Observation', 'inbox-reply-observation', NOW())`,
    [ORG],
  )
  await pool.query(
    `INSERT INTO properties
      (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Inbox Reply Property', 'inbox-reply-property', 'UTC', NOW(), NOW())`,
    [PROPERTY, ORG],
  )
  await pool.query(
    `WITH identity AS (
       INSERT INTO reviews (
         id, organization_id, property_id, platform, external_id,
         external_location_id, expires_at, first_fetched_at,
         source_epoch, source_revision, source_observation_sequence,
         analysis_sequence, source_content_state, created_at, updated_at
       ) VALUES (
         $1, $2, $3, 'google', $4, 'locations/inbox-reply-observation', $6, $5,
         0, 1, 0, 1, 'active', $5, $5
       )
       RETURNING id
     ) INSERT INTO review_source_contents (
       review_id, organization_id, property_id, platform, external_id,
       external_location_id, rating, reviewed_at, content_expires_at,
       first_fetched_at, last_fetched_at, source_epoch, source_revision,
       ai_source_byte_length, ai_source_digest
     ) SELECT id, $2, $3, 'google', $4, 'locations/inbox-reply-observation', 5, $5,
       $6, $5, $5, 0, 1, 1, $7 FROM identity`,
    [REVIEW, ORG, PROPERTY, `external-${REVIEW}`, OPENED_AT, EXPIRES_AT, '0'.repeat(64)],
  )
  await pool.query(
    `INSERT INTO material_review_revisions (
       review_id, revision, organization_id, property_id, source_epoch,
       normalization_version, source_digest, normalized_digest, rating,
       normalized_text, content_state, response_target_eligibility,
       response_target_start_at, created_at, updated_at
     ) VALUES (
       $1, 1, $2, $3, 0, 'review-material-v1', $4, $4, 5,
       'review text', 'active', $6, $7, $5, $5
     )`,
    [
      REVIEW,
      ORG,
      PROPERTY,
      '1'.repeat(64),
      OPENED_AT,
      options.measured ? 'measured' : 'legacy_unknown',
      options.measured ? sourceCreatedAt : null,
    ],
  )
  if (options.targetMinutes !== undefined) {
    await pool.query(
      `INSERT INTO inbox_response_target_organization_policies (
         organization_id, target_kind, duration_minutes, policy_version,
         updated_by, created_at, updated_at
       ) VALUES ($1, 'google_review_response', $2, 1, 'policy-manager', $3, $3)`,
      [ORG, options.targetMinutes, OPENED_AT],
    )
  }
  const item = makeItem()
  await createAtomicInboxCommandStore(getDb()).createItem(
    item,
    null,
    options.measured
      ? {
          sourceRevision: 1,
          openedReason: 'review_observed',
          actorType: 'provider',
          triggerEventId: null,
          openedAt: OPENED_AT,
          responseTarget: measuredResponseTargetPermit(sourceCreatedAt),
        }
      : reviewOpeningAnchor(item),
  )
  return item
}

export type Observation = Readonly<{
  revision: number
  sourceEpoch?: number
  materialReviewRevision?: number
  state: 'live' | 'absent'
  change: 'added' | 'edited' | 'deleted'
  resolution: 'external_current_live' | 'confirmed_on_google' | 'diverged' | 'absent'
  provenance: 'external_or_unknown' | 'repkey_confirmed' | 'none'
  /** Google's reply updateTime; null or omitted when Google gave none. */
  providerUpdatedAt?: Date | null
  /** When RepKey read it; defaults to OBSERVED_AT. */
  observedAt?: Date
}>

export async function insertObservation(observation: Observation): Promise<void> {
  const live = observation.state === 'live'
  const sourceEpoch = observation.sourceEpoch ?? 0
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const inserted = await client.query(
      `INSERT INTO google_reply_observations (
         organization_id, property_id, review_id, observation_revision,
         observation_key, input_digest, source_epoch, material_review_revision,
         read_generation, state, change, resolution, source, provenance, normalized_text,
         normalization_version, normalized_digest, observed_at, content_expires_at,
         provider_updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $4, $9, $10, $11,
         'provider_snapshot', $12, $13, 'google-reply-v1', $14, $15, $16, $17
       ) RETURNING id`,
      [
        ORG,
        PROPERTY,
        REVIEW,
        observation.revision,
        String(observation.revision).repeat(64).slice(0, 64),
        String(observation.revision + 3)
          .repeat(64)
          .slice(0, 64),
        sourceEpoch,
        observation.materialReviewRevision ?? 1,
        observation.state,
        observation.change,
        observation.resolution,
        observation.provenance,
        live ? `reply-${observation.revision}` : null,
        live
          ? String(observation.revision + 6)
              .repeat(64)
              .slice(0, 64)
          : null,
        observation.observedAt ?? OBSERVED_AT,
        EXPIRES_AT,
        observation.providerUpdatedAt ?? null,
      ],
    )
    await client.query(
      `INSERT INTO google_reply_observation_heads (
         review_id, organization_id, property_id, observation_id,
         observation_revision, source_epoch, material_review_revision,
         state, provenance, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
       ON CONFLICT (review_id) DO UPDATE SET
         observation_id = EXCLUDED.observation_id,
         observation_revision = EXCLUDED.observation_revision,
         source_epoch = EXCLUDED.source_epoch,
         material_review_revision = EXCLUDED.material_review_revision,
         state = EXCLUDED.state,
         provenance = EXCLUDED.provenance,
         updated_at = EXCLUDED.updated_at`,
      [
        REVIEW,
        ORG,
        PROPERTY,
        inserted.rows[0].id,
        observation.revision,
        sourceEpoch,
        observation.materialReviewRevision ?? 1,
        observation.state,
        observation.provenance,
        observation.observedAt ?? OBSERVED_AT,
      ],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function insertMaterialRevision(revision: number): Promise<void> {
  await pool.query(
    `INSERT INTO material_review_revisions (
       review_id, revision, organization_id, property_id, source_epoch,
       normalization_version, source_digest, normalized_digest, rating,
       normalized_text, content_state, created_at, updated_at
     ) VALUES (
       $1, $2::bigint, $3, $4, 0, 'review-material-v1', $5, $5, 5,
       'review text revision ' || ($2::bigint)::text, 'active', $6, $6
     )`,
    [
      REVIEW,
      revision,
      ORG,
      PROPERTY,
      String(revision + 7)
        .repeat(64)
        .slice(0, 64),
      OBSERVED_AT,
    ],
  )
  await pool.query(
    `UPDATE reviews
     SET source_revision = $2::bigint, updated_at = $3
     WHERE id = $1 AND organization_id = $4`,
    [REVIEW, revision, OBSERVED_AT, ORG],
  )
}

export async function advanceMaterialRevisionToEpochOne(
  normalizedDigest: string,
  normalizedText: string,
): Promise<void> {
  await pool.query(
    `UPDATE properties
     SET source_epoch = 1, updated_at = $3
     WHERE id = $1 AND organization_id = $2`,
    [PROPERTY, ORG, OBSERVED_AT],
  )
  await pool.query(
    `INSERT INTO material_review_revisions (
       review_id, revision, organization_id, property_id, source_epoch,
       normalization_version, source_digest, normalized_digest, rating,
       normalized_text, content_state, created_at, updated_at
     ) VALUES (
       $1, 2, $2, $3, 1, 'review-material-v1', $4, $4, 5,
       $5, 'active', $6, $6
     )`,
    [REVIEW, ORG, PROPERTY, normalizedDigest, normalizedText, OBSERVED_AT],
  )
  await pool.query(
    `UPDATE reviews
     SET source_epoch = 1, source_revision = 2, updated_at = $3
     WHERE id = $1 AND organization_id = $2`,
    [REVIEW, ORG, OBSERVED_AT],
  )
}

export async function seedDeliveryEvent(eventId: string): Promise<void> {
  await pool.query(
    `INSERT INTO outbox_events (
       id, event_type, event_version, payload, organization_id, property_id,
       source_context, source_aggregate_id, created_at
     ) VALUES ($1, 'review.reply.observed', 1, '{}'::jsonb, $2, $3,
               'review', $4, $5)`,
    [eventId, ORG, PROPERTY, REVIEW, OBSERVED_AT],
  )
}

export function expectation(observation: Observation) {
  return {
    organizationId: ORG,
    reviewId: REVIEW,
    propertyId: PROPERTY,
    observationRevision: observation.revision,
    sourceEpoch: observation.sourceEpoch ?? 0,
    materialReviewRevision: observation.materialReviewRevision ?? 1,
    change: observation.change,
    resolution: observation.resolution,
    provenance: observation.provenance,
    matchedReplyId: null,
    matchedPublicationCycle: null,
    occurredAt: observation.observedAt ?? OBSERVED_AT,
  } as const
}

export function observedEvent(eventId: string, observation: Observation): ConsumerEvent {
  return {
    eventId,
    eventType: 'review.reply.observed',
    eventVersion: 1,
    payload: expectation(observation),
    organizationId: ORG,
    propertyId: PROPERTY,
    sourceContext: 'review',
    sourceAggregateId: REVIEW,
  }
}

export function consumerDeps(): InboxConsumerDeps {
  const commandStore = createAtomicInboxCommandStore(getDb())
  const reviewLookup = {
    getReviewSnippetById: async () => ({ status: 'not_found' as const }),
    getReviewSnippetsByIds: async () => new Map(),
    findEligibleReviewIds: async () => [],
  } satisfies ReviewLookupPort
  const inboxRepo = createInboxRepository(
    getDb(),
    {
      reviewLookup,
      feedbackLookup: {
        getFeedbackSnippetById: async () => null,
        getFeedbackSnippetsByIds: async () => new Map(),
        findEligibleFeedbackIds: async () => [],
      } satisfies FeedbackLookupPort,
      propertyLookup: {
        getPropertyNameById: async () => null,
        getPropertyNamesByIds: async () => new Map(),
      } satisfies PropertyLookupPort,
    },
    { clock: () => OBSERVED_AT, logger },
  )
  return {
    commandStore,
    handlingCycleStore: createReviewHandlingCycleStore(getDb()),
    replyObservationAuthority: createReviewReplyObservationAuthority(getDb()),
    responseTargetAuthority: {
      withExactCurrent: async () => ({ status: 'obsolete' as const }),
      withExactCurrentBatch: async () => ({ status: 'obsolete' as const }),
      withInboxProjection: async () => ({ status: 'obsolete' as const }),
    },
    sourceTransitionAuthority: createReviewSourceTransitionAuthority(getDb()),
    reviewLookup,
    reviewSourceLookup: {
      getReviewSourceMetaById: async () => null,
      getReviewSourceMetaByIds: async () => [],
      listReviewSources: async () => [],
    },
    inboxRepo,
    idGen: () => ITEM,
    clock: () => OBSERVED_AT,
    logger,
  }
}

export function command(
  item: InboxItem,
  eventId: string,
  currentObservation: CurrentReplyObservationPermit,
) {
  return {
    eventId,
    consumerName: 'inbox.on-reply-observed',
    item,
    currentObservation,
    closeFact: inboxItemStatusChanged({
      inboxItemId: ITEM,
      organizationId: ORG,
      propertyId: PROPERTY,
      oldStatus: 'open',
      newStatus: 'closed',
      occurredAt: OBSERVED_AT,
    }),
    reopenFact: inboxItemStatusChanged({
      inboxItemId: ITEM,
      organizationId: ORG,
      propertyId: PROPERTY,
      oldStatus: 'closed',
      newStatus: 'open',
      occurredAt: OBSERVED_AT,
    }),
  } as const
}

export async function applyObservation(
  item: InboxItem,
  eventId: string,
  observation: Observation,
): Promise<'applied' | 'obsolete'> {
  const store = createAtomicInboxCommandStore(getDb())
  const authority = createReviewReplyObservationAuthority(getDb())
  const result = await authority.withExactCurrent(expectation(observation), (permit) =>
    store.applyReplyObservedOnce(command(item, eventId, permit)),
  )
  if (result.status === 'current') return result.value
  await store.recordReceipt(eventId, 'inbox.on-reply-observed', 'obsolete')
  return 'obsolete'
}

const OBSERVATION_DEFAULTS = {
  revision: 1,
  state: 'live',
  change: 'added',
  resolution: 'external_current_live',
  provenance: 'external_or_unknown',
} as const satisfies Observation

/** A current external live reply, with only the fields a test varies. */
export const observation = (overrides: Partial<Observation> = {}): Observation => ({
  ...OBSERVATION_DEFAULTS,
  ...overrides,
})

const waitForCount = (query: string, atLeast: number, timeout?: number) =>
  vi.waitFor(
    async () => {
      const waiting = await pool.query(query)
      expect(waiting.rows[0].n).toBeGreaterThanOrEqual(atLeast)
    },
    timeout === undefined ? undefined : { timeout },
  )

/** Statements queued behind a lock on an Inbox item row. */
export const waitForInboxRowWaiters = (atLeast: number) =>
  waitForCount(
    `SELECT count(*)::int AS n
     FROM pg_stat_activity
     WHERE datname = current_database()
       AND wait_event_type = 'Lock'
       AND query LIKE '%inbox_items%'`,
    atLeast,
    5_000,
  )

/** A writer queued behind an advisory lock; the count is database-wide. */
export const waitForAdvisoryWaiter = () =>
  waitForCount(
    `SELECT count(*)::int AS n
     FROM pg_locks
     WHERE locktype = 'advisory'
       AND granted = false
       AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
    1,
  )

/** Starts the writer of a newer provider reply; it settles only once the fence it queues behind is released. */
export function startNewerObservationWriter() {
  let isSettled = false
  const result = createGoogleReplyObservationStore(getDb())
    .record({
      organizationId: ORG,
      propertyId: PROPERTY,
      reviewId: REVIEW,
      sourceEpoch: 0,
      materialReviewRevision: 1,
      readGeneration: 2,
      observationKey: 'f'.repeat(64),
      source: 'provider_snapshot',
      observedText: 'newer provider reply',
      providerUpdatedAt: new Date('2026-08-20T12:05:00.000Z'),
      observedAt: new Date('2026-08-20T12:05:00.000Z'),
      contentExpiresAt: new Date('2026-09-20T12:05:00.000Z'),
    })
    .finally(() => {
      isSettled = true
    })
  return { result, settled: () => isSettled }
}

/** Closes the item's current cycle by a manager reopen that restarts the measured target at `reopenAt`. */
export async function reopenMeasured(reopenAt: Date) {
  const closedHead = await createReviewHandlingCycleStore(getDb()).findHead(ITEM, ORG)
  if (closedHead === null) throw new Error('seeded Handling Cycle is missing')
  await openNextReviewCycleForTest(getDb(), {
    inboxItemId: ITEM,
    organizationId: ORG,
    materialReviewRevision: 1,
    openedReason: 'manual_reopen',
    manualReopenReason: 'internal_follow_up_still_needed',
    manualReopenExplanation: null,
    openedBy: MANUAL_REOPEN_ACTOR,
    openedAt: reopenAt,
    responseTarget: {
      reviewAuthority: {
        ...measuredResponseTargetPermit().reviewAuthority,
        responseTargetStartAt: reopenAt,
      },
      targetStart: { basis: 'operational_reopen', at: reopenAt },
    },
  })
}

/** Opens the next cycle for a newer material review revision. */
export async function openMaterialRevisionCycle(
  deps: Pick<InboxConsumerDeps, 'handlingCycleStore'>,
  revision: number,
) {
  const cycleHead = await deps.handlingCycleStore.findHead(ITEM, ORG)
  if (cycleHead === null) throw new Error('seeded Handling Cycle is missing')
  await openNextReviewCycleForTest(getDb(), {
    inboxItemId: ITEM,
    organizationId: ORG,
    materialReviewRevision: revision,
    openedReason: 'material_revision_changed',
    openedBy: null,
    openedAt: OBSERVED_AT,
    responseTarget: responseTargetPermit(revision),
  })
}

/** Registers the database lease and per-test cleanup for one suite and returns its pool. */
export function useReplyObservationSuite() {
  let lease: TestLease
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 3)
    pool = lease.pool
  })
  beforeEach(clean)
  afterAll(async () => {
    await clean()
    await lease.release()
  })
  return {
    get pool() {
      return pool
    },
  }
}
