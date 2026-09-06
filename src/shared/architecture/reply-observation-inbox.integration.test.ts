import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { getDb, type Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem } from '#/contexts/inbox/domain/types'
import { inboxItemStatusChanged } from '#/contexts/inbox/domain/events'
import {
  createAtomicInboxCommandStore as createProductionInboxCommandStore,
  type InboxCommandAuthority,
} from '#/contexts/inbox/infrastructure/inbox-command-store'
import { createInboxRepository } from '#/contexts/inbox/infrastructure/repositories/inbox.repository'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createReviewReplyObservationAuthority } from '#/contexts/review/infrastructure/reply-observation-authority'
import { createReviewSourceTransitionAuthority } from '#/contexts/review/infrastructure/source-transition-authority'
import { createGoogleReplyObservationStore } from '#/contexts/review/infrastructure/google-reply-observation-store'
import { eraseReviewSourceContent } from '#/contexts/review/infrastructure/review-source-content-store'
import { createReplyObservationAuthorityAdapter } from '#/contexts/inbox/infrastructure/adapters/reply-observation-authority.adapter'
import { createSourceTransitionAuthorityAdapter } from '#/contexts/inbox/infrastructure/adapters/source-transition-authority.adapter'
import type { CurrentReplyObservationPermit } from '#/contexts/inbox/application/ports/reply-observation-authority.port'
import {
  handleInboxReplyObserved,
  type InboxConsumerDeps,
} from '#/contexts/inbox/infrastructure/outbox-consumers'
import { createReviewHandlingCycleStore } from '#/contexts/inbox/infrastructure/review-handling-cycle.store'
import type { ConsumerEvent } from '#/shared/outbox'
import type { ReviewLookupPort } from '#/contexts/inbox/application/ports/review-lookup.port'
import type { FeedbackLookupPort } from '#/contexts/inbox/application/ports/feedback-lookup.port'
import type { PropertyLookupPort } from '#/contexts/inbox/application/ports/property-lookup.port'
import { createMockLogger } from '#/shared/testing/mock-logger'

const ORG = organizationId('org-inbox-reply-observation')
const PROPERTY = propertyId('b2000000-0000-0000-0000-000000000001')
const REVIEW = reviewId('b2000000-0000-0000-0000-000000000010')
const ITEM = inboxItemId('b2000000-0000-0000-0000-000000000020')
const MANUAL_REOPEN_ACTOR = userId('user-inbox-reply-observation-manager')
const OPENED_AT = new Date('2026-08-20T10:00:00.000Z')
const OBSERVED_AT = new Date('2026-08-20T12:00:00.000Z')
const EXPIRES_AT = new Date('2026-09-20T12:00:00.000Z')
const EVENT_LIVE = 'b2000000-0000-0000-0000-000000000101'
const EVENT_DELETED = 'b2000000-0000-0000-0000-000000000102'
const EVENT_EXTERNAL_EDITED = 'b2000000-0000-0000-0000-000000000103'

const responseTargetPermit = (materialReviewRevision: number) => ({
  reviewAuthority: {
    authority: 'review.current-response-target.v1' as const,
    organizationId: ORG,
    propertyId: PROPERTY,
    reviewId: REVIEW,
    sourceEpoch: 0,
    materialReviewRevision,
    eligibility: 'legacy_unknown' as const,
    responseTargetStartAt: null,
  },
  targetStart: { basis: 'review_provenance' as const },
})

const allowAllCommandAuthority: InboxCommandAuthority = async () => ({
  allowed: true,
})
const logger = createMockLogger()

const createAtomicInboxCommandStore = (database: Database) =>
  createProductionInboxCommandStore(database, allowAllCommandAuthority, () => OBSERVED_AT)
const EVENT_STALE = 'b2000000-0000-0000-0000-000000000104'
const EVENT_AHEAD = 'b2000000-0000-0000-0000-000000000105'
const EVENT_OLDER = 'b2000000-0000-0000-0000-000000000106'
const EVENT_REVIEW_ADVANCED = 'b2000000-0000-0000-0000-000000000107'
const EVENT_LEGACY_DIVERGED = 'b2000000-0000-0000-0000-000000000108'
const EVENT_LOCK_ORDER = 'b2000000-0000-0000-0000-000000000109'
const EVENT_INACTIVE_DELETED = 'b2000000-0000-0000-0000-000000000110'
const EVENT_EPOCH_CARRY = 'b2000000-0000-0000-0000-000000000111'
const EVENT_EPOCH_MATERIAL_CHANGE = 'b2000000-0000-0000-0000-000000000112'

let pool: Pool
let lease: TestLease

function makeItem(): InboxItem {
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

async function clean(): Promise<void> {
  await pool.query(
    'TRUNCATE google_reply_observation_heads, google_reply_observations, reply_publication_attempts CASCADE',
  )
  await pool.query('DELETE FROM event_consumer_receipts WHERE consumer_name = $1', [
    'inbox.on-reply-observed',
  ])
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await deleteTestOrganizations(pool, [ORG])
}

async function seed(): Promise<InboxItem> {
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
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id,
       external_location_id, rating, reviewed_at, expires_at,
       source_epoch, source_revision, source_observation_sequence,
       analysis_sequence, ai_source_byte_length, ai_source_digest,
       source_content_state, created_at, updated_at
     ) VALUES (
       $1, $2, $3, 'google', $4, 'locations/inbox-reply-observation', 5,
       $5, $6, 0, 1, 0, 1, 1, $7, 'active', $5, $5
     )`,
    [REVIEW, ORG, PROPERTY, `external-${REVIEW}`, OPENED_AT, EXPIRES_AT, '0'.repeat(64)],
  )
  await pool.query(
    `INSERT INTO material_review_revisions (
       review_id, revision, organization_id, property_id, source_epoch,
       normalization_version, source_digest, normalized_digest, rating,
       normalized_text, content_state, created_at, updated_at
     ) VALUES (
       $1, 1, $2, $3, 0, 'review-material-v1', $4, $4, 5,
       'review text', 'active', $5, $5
     )`,
    [REVIEW, ORG, PROPERTY, '1'.repeat(64), OPENED_AT],
  )
  const item = makeItem()
  await createAtomicInboxCommandStore(getDb()).createItem(item, null, {
    materialReviewRevision: 1,
  })
  return item
}

type Observation = Readonly<{
  revision: number
  sourceEpoch?: number
  materialReviewRevision?: number
  state: 'live' | 'absent'
  change: 'added' | 'edited' | 'deleted'
  resolution: 'external_current_live' | 'confirmed_on_google' | 'diverged' | 'absent'
  provenance: 'external_or_unknown' | 'repkey_confirmed' | 'none'
}>

async function insertObservation(observation: Observation): Promise<void> {
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
         normalization_version, normalized_digest, observed_at, content_expires_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $4, $9, $10, $11,
         'provider_snapshot', $12, $13, 'google-reply-v1', $14, $15, $16
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
        OBSERVED_AT,
        EXPIRES_AT,
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
        OBSERVED_AT,
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

async function insertMaterialRevision(revision: number): Promise<void> {
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

async function advanceMaterialRevisionToEpochOne(
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

async function seedDeliveryEvent(eventId: string): Promise<void> {
  await pool.query(
    `INSERT INTO outbox_events (
       id, event_type, event_version, payload, organization_id, property_id,
       source_context, source_aggregate_id, created_at
     ) VALUES ($1, 'review.reply.observed', 1, '{}'::jsonb, $2, $3,
               'review', $4, $5)`,
    [eventId, ORG, PROPERTY, REVIEW, OBSERVED_AT],
  )
}

function expectation(observation: Observation) {
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
    occurredAt: OBSERVED_AT,
  } as const
}

function observedEvent(eventId: string, observation: Observation): ConsumerEvent {
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

function consumerDeps(): InboxConsumerDeps {
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
    replyObservationAuthority: createReplyObservationAuthorityAdapter(
      createReviewReplyObservationAuthority(getDb()),
    ),
    responseTargetAuthority: {
      withExactCurrent: async () => ({ status: 'obsolete' as const }),
      withExactCurrentBatch: async () => ({ status: 'obsolete' as const }),
      withInboxProjection: async () => ({ status: 'obsolete' as const }),
    },
    sourceTransitionAuthority: createSourceTransitionAuthorityAdapter(
      createReviewSourceTransitionAuthority(getDb()),
    ),
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

function command(
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

async function applyObservation(
  item: InboxItem,
  eventId: string,
  observation: Observation,
): Promise<'applied' | 'obsolete'> {
  const store = createAtomicInboxCommandStore(getDb())
  const authority = createReplyObservationAuthorityAdapter(
    createReviewReplyObservationAuthority(getDb()),
  )
  const result = await authority.withExactCurrent(expectation(observation), (permit) =>
    store.applyReplyObservedOnce(command(item, eventId, permit)),
  )
  if (result.status === 'current') return result.value
  await store.recordReceipt(eventId, 'inbox.on-reply-observed', 'obsolete')
  return 'obsolete'
}

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 3)
  pool = lease.pool
  clearEventSchemas()
  registerAllEventSchemas()
})

beforeEach(clean)

afterAll(async () => {
  await clean()
  clearEventSchemas()
  await lease.release()
})

describe.sequential('Inbox provider-observation authority (real PostgreSQL)', () => {
  const live: Observation = {
    revision: 1,
    state: 'live',
    change: 'added',
    resolution: 'external_current_live',
    provenance: 'external_or_unknown',
  }

  it('closes once from the exact current live observation and a replay cannot re-close', async () => {
    const item = await seed()
    await insertObservation(live)
    await seedDeliveryEvent(EVENT_LIVE)
    expect(await applyObservation(item, EVENT_LIVE, live)).toBe('applied')
    const closed = await pool.query(
      `SELECT status, closed_at, first_reply_published_at
       FROM inbox_items WHERE id = $1`,
      [ITEM],
    )
    expect(closed.rows[0]).toMatchObject({
      status: 'closed',
      closed_at: OBSERVED_AT,
      first_reply_published_at: OBSERVED_AT,
    })

    const deleted: Observation = {
      revision: 2,
      state: 'absent',
      change: 'deleted',
      resolution: 'absent',
      provenance: 'none',
    }
    await insertObservation(deleted)
    await seedDeliveryEvent(EVENT_DELETED)
    expect(await applyObservation(item, EVENT_DELETED, deleted)).toBe('applied')

    const reopened = await pool.query(
      `SELECT status, closed_at, first_reply_published_at
       FROM inbox_items WHERE id = $1`,
      [ITEM],
    )
    expect(reopened.rows[0]).toMatchObject({
      status: 'open',
      closed_at: null,
      first_reply_published_at: OBSERVED_AT,
    })
    const cycles = await pool.query(
      `SELECT cycle_number, opened_reason
       FROM inbox_handling_cycles WHERE inbox_item_id = $1 ORDER BY cycle_number`,
      [ITEM],
    )
    expect(cycles.rows).toMatchObject([
      { cycle_number: '1', opened_reason: 'review_observed' },
      { cycle_number: '2', opened_reason: 'provider_reply_deleted' },
    ])
    const facts = await pool.query(
      `SELECT count(*)::int AS n FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'inbox.inbox_item.status_changed'`,
      [ORG],
    )
    expect(facts.rows[0].n).toBe(2)
  })

  it('holds the Review writer fence until the Inbox callback commits', async () => {
    const item = await seed()
    await insertObservation(live)
    await seedDeliveryEvent(EVENT_LIVE)
    const store = createAtomicInboxCommandStore(getDb())
    const authority = createReplyObservationAuthorityAdapter(
      createReviewReplyObservationAuthority(getDb()),
    )
    let callbackEntered!: () => void
    const entered = new Promise<void>((resolve) => {
      callbackEntered = resolve
    })
    let allowInboxCommit!: () => void
    const inboxCommitAllowed = new Promise<void>((resolve) => {
      allowInboxCommit = resolve
    })
    const authorityResult = authority.withExactCurrent(
      expectation(live),
      async (permit) => {
        callbackEntered()
        await inboxCommitAllowed
        return store.applyReplyObservedOnce(command(item, EVENT_LIVE, permit))
      },
    )
    await entered

    let writerSettled = false
    const writer = createGoogleReplyObservationStore(getDb())
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
        writerSettled = true
      })

    await vi.waitFor(async () => {
      const waiting = await pool.query(
        `SELECT count(*)::int AS n
         FROM pg_locks
         WHERE locktype = 'advisory'
           AND granted = false
           AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
      )
      expect(waiting.rows[0].n).toBeGreaterThanOrEqual(1)
    })
    expect(writerSettled).toBe(false)

    allowInboxCommit()
    await expect(authorityResult).resolves.toEqual({
      status: 'current',
      value: 'applied',
    })
    await expect(writer).resolves.toMatchObject({
      observationRevision: 2,
      resolution: 'external_current_live',
    })
    const committed = await pool.query(
      `SELECT i.status, h.observation_revision
       FROM inbox_items i
       JOIN google_reply_observation_heads h ON h.review_id = i.source_id
       WHERE i.id = $1`,
      [ITEM],
    )
    expect(committed.rows[0]).toMatchObject({
      status: 'closed',
      observation_revision: '2',
    })
  })

  it('serializes a manual cycle reopen before an observed close without deadlocking', async () => {
    const item = await seed()
    await insertObservation(live)
    await seedDeliveryEvent(EVENT_LIVE)
    expect(await applyObservation(item, EVENT_LIVE, live)).toBe('applied')

    const newerLive: Observation = {
      revision: 2,
      state: 'live',
      change: 'edited',
      resolution: 'external_current_live',
      provenance: 'external_or_unknown',
    }
    await insertObservation(newerLive)
    await seedDeliveryEvent(EVENT_LOCK_ORDER)

    const cycleStore = createReviewHandlingCycleStore(getDb())
    const closedHead = await cycleStore.findHead(ITEM, ORG)
    if (closedHead === null) throw new Error('seeded Handling Cycle is missing')

    // Hold the shared first lock so both public command paths queue in a known
    // order. Once released, the reopen must acquire head -> item and commit;
    // the observed close then acquires the same order and closes that new cycle.
    const blocker = await pool.connect()
    let blockerOpen = false
    let reopen: ReturnType<typeof cycleStore.startNext> | null = null
    let observedClose: Promise<'applied' | 'obsolete'> | null = null
    try {
      await blocker.query('BEGIN')
      blockerOpen = true
      await blocker.query(
        `SELECT inbox_item_id
         FROM inbox_handling_cycle_heads
         WHERE inbox_item_id = $1 AND organization_id = $2
         FOR UPDATE`,
        [ITEM, ORG],
      )

      reopen = cycleStore.startNext({
        inboxItemId: ITEM,
        organizationId: ORG,
        expected: {
          cycleNumber: closedHead.currentCycleNumber,
          materialReviewRevision: closedHead.currentMaterialReviewRevision,
          stateRevision: closedHead.stateRevision,
        },
        materialReviewRevision: 1,
        openedReason: 'manual_reopen',
        manualReopenReason: 'internal_follow_up_still_needed',
        manualReopenExplanation: null,
        openedBy: MANUAL_REOPEN_ACTOR,
        openedAt: OBSERVED_AT,
        responseTarget: responseTargetPermit(1),
      })
      await vi.waitFor(
        async () => {
          const waiting = await pool.query(
            `SELECT count(*)::int AS n
             FROM pg_stat_activity
             WHERE datname = current_database()
               AND wait_event_type = 'Lock'
               AND query LIKE '%inbox_handling_cycle_heads%'`,
          )
          expect(waiting.rows[0].n).toBeGreaterThanOrEqual(1)
        },
        { timeout: 5_000 },
      )

      observedClose = applyObservation(item, EVENT_LOCK_ORDER, newerLive)
      await vi.waitFor(
        async () => {
          const waiting = await pool.query(
            `SELECT count(*)::int AS n
             FROM pg_stat_activity
             WHERE datname = current_database()
               AND wait_event_type = 'Lock'
               AND query LIKE '%inbox_handling_cycle_heads%'`,
          )
          expect(waiting.rows[0].n).toBeGreaterThanOrEqual(2)
        },
        { timeout: 5_000 },
      )

      await blocker.query('COMMIT')
      blockerOpen = false
      await expect(Promise.all([reopen, observedClose])).resolves.toMatchObject([
        { head: { currentCycleNumber: 2, status: 'open' } },
        'applied',
      ])
    } finally {
      if (blockerOpen) await blocker.query('ROLLBACK')
      blocker.release()
      await Promise.allSettled([
        ...(reopen ? [reopen] : []),
        ...(observedClose ? [observedClose] : []),
      ])
    }

    const current = await pool.query(
      `SELECT i.status, h.current_cycle_number, h.status AS head_status,
              h.state_revision, c.opened_reason, c.manual_reopen_reason,
              c.opened_by, r.status AS receipt_status
       FROM inbox_items i
       JOIN inbox_handling_cycle_heads h ON h.inbox_item_id = i.id
       JOIN inbox_handling_cycles c
         ON c.inbox_item_id = h.inbox_item_id
        AND c.cycle_number = h.current_cycle_number
       JOIN event_consumer_receipts r
         ON r.event_id = $2 AND r.consumer_name = 'inbox.on-reply-observed'
       WHERE i.id = $1`,
      [ITEM, EVENT_LOCK_ORDER],
    )
    expect(current.rows[0]).toMatchObject({
      status: 'closed',
      current_cycle_number: '2',
      head_status: 'closed',
      state_revision: '4',
      opened_reason: 'manual_reopen',
      manual_reopen_reason: 'internal_follow_up_still_needed',
      opened_by: MANUAL_REOPEN_ACTOR,
      receipt_status: 'applied',
    })
  })

  it('keeps work closed when the current external live reply is edited', async () => {
    const item = await seed()
    await insertObservation(live)
    await seedDeliveryEvent(EVENT_LIVE)
    await applyObservation(item, EVENT_LIVE, live)

    const externalEdit: Observation = {
      revision: 2,
      state: 'live',
      change: 'edited',
      resolution: 'external_current_live',
      provenance: 'external_or_unknown',
    }
    await insertObservation(externalEdit)
    await seedDeliveryEvent(EVENT_EXTERNAL_EDITED)
    expect(await applyObservation(item, EVENT_EXTERNAL_EDITED, externalEdit)).toBe(
      'applied',
    )

    const current = await pool.query(
      `SELECT i.status, h.current_cycle_number, c.opened_reason,
              (SELECT count(*)::int
               FROM outbox_events e
               WHERE e.organization_id = i.organization_id
                 AND e.event_type = 'inbox.inbox_item.status_changed') AS status_fact_count
       FROM inbox_items i
       JOIN inbox_handling_cycle_heads h ON h.inbox_item_id = i.id
       JOIN inbox_handling_cycles c
         ON c.inbox_item_id = h.inbox_item_id
        AND c.cycle_number = h.current_cycle_number
       WHERE i.id = $1`,
      [ITEM],
    )
    expect(current.rows[0]).toMatchObject({
      status: 'closed',
      current_cycle_number: '1',
      opened_reason: 'review_observed',
      status_fact_count: 1,
    })
  })

  it('applies an epoch-carried reply observation without reopening closed work', async () => {
    await seed()
    await insertObservation(live)
    await seedDeliveryEvent(EVENT_LIVE)
    await expect(
      handleInboxReplyObserved(consumerDeps(), observedEvent(EVENT_LIVE, live)),
    ).resolves.toEqual({ status: 'applied' })

    await advanceMaterialRevisionToEpochOne('1'.repeat(64), 'review text')
    const carried: Observation = {
      revision: 2,
      sourceEpoch: 1,
      materialReviewRevision: 2,
      state: 'live',
      change: 'added',
      resolution: 'external_current_live',
      provenance: 'external_or_unknown',
    }
    await insertObservation(carried)
    await seedDeliveryEvent(EVENT_EPOCH_CARRY)

    await expect(
      handleInboxReplyObserved(consumerDeps(), observedEvent(EVENT_EPOCH_CARRY, carried)),
    ).resolves.toEqual({ status: 'applied' })

    const current = await pool.query(
      `SELECT i.status, h.current_cycle_number,
              h.current_material_review_revision,
              h.state_revision, h.status AS head_status,
              r.status AS receipt_status,
              (SELECT count(*)::int
               FROM inbox_handling_cycles c
               WHERE c.inbox_item_id = i.id) AS cycle_count,
              (SELECT count(*)::int
               FROM outbox_events e
               WHERE e.organization_id = i.organization_id
                 AND e.event_type = 'inbox.inbox_item.status_changed') AS status_fact_count
       FROM inbox_items i
       JOIN inbox_handling_cycle_heads h ON h.inbox_item_id = i.id
       JOIN event_consumer_receipts r
         ON r.event_id = $2 AND r.consumer_name = 'inbox.on-reply-observed'
       WHERE i.id = $1`,
      [ITEM, EVENT_EPOCH_CARRY],
    )
    expect(current.rows[0]).toMatchObject({
      status: 'closed',
      current_cycle_number: '1',
      current_material_review_revision: '2',
      state_revision: '2',
      head_status: 'closed',
      receipt_status: 'applied',
      cycle_count: 1,
      status_fact_count: 1,
    })
  })

  it('refuses an epoch-crossing material change while its Inbox projection is stale', async () => {
    await seed()
    await advanceMaterialRevisionToEpochOne('2'.repeat(64), 'changed review text')
    const changed: Observation = {
      revision: 2,
      sourceEpoch: 1,
      materialReviewRevision: 2,
      state: 'live',
      change: 'added',
      resolution: 'external_current_live',
      provenance: 'external_or_unknown',
    }
    await insertObservation(changed)
    await seedDeliveryEvent(EVENT_EPOCH_MATERIAL_CHANGE)

    await expect(
      handleInboxReplyObserved(
        consumerDeps(),
        observedEvent(EVENT_EPOCH_MATERIAL_CHANGE, changed),
      ),
    ).rejects.toMatchObject({
      code: 'revision_conflict',
      message: 'Current reply observation is waiting for the Inbox material revision',
    })

    const current = await pool.query(
      `SELECT i.status, h.current_material_review_revision,
              r.status AS receipt_status
       FROM inbox_items i
       JOIN inbox_handling_cycle_heads h ON h.inbox_item_id = i.id
       LEFT JOIN event_consumer_receipts r
         ON r.event_id = $2 AND r.consumer_name = 'inbox.on-reply-observed'
       WHERE i.id = $1`,
      [ITEM, EVENT_EPOCH_MATERIAL_CHANGE],
    )
    expect(current.rows[0]).toMatchObject({
      status: 'open',
      current_material_review_revision: '1',
      receipt_status: null,
    })
  })

  it('receipts a retained legacy live divergence without reopening work', async () => {
    const item = await seed()
    await insertObservation(live)
    await seedDeliveryEvent(EVENT_LIVE)
    expect(await applyObservation(item, EVENT_LIVE, live)).toBe('applied')

    const legacyDiverged: Observation = {
      revision: 2,
      state: 'live',
      change: 'edited',
      resolution: 'diverged',
      provenance: 'external_or_unknown',
    }
    await insertObservation(legacyDiverged)
    await seedDeliveryEvent(EVENT_LEGACY_DIVERGED)
    expect(await applyObservation(item, EVENT_LEGACY_DIVERGED, legacyDiverged)).toBe(
      'applied',
    )

    const result = await pool.query(
      `SELECT i.status, h.current_cycle_number, r.status AS receipt_status,
              (SELECT count(*)::int
               FROM outbox_events e
               WHERE e.organization_id = i.organization_id
                 AND e.event_type = 'inbox.inbox_item.status_changed') AS status_fact_count
       FROM inbox_items i
       JOIN inbox_handling_cycle_heads h ON h.inbox_item_id = i.id
       JOIN event_consumer_receipts r
         ON r.event_id = $2 AND r.consumer_name = 'inbox.on-reply-observed'
       WHERE i.id = $1`,
      [ITEM, EVENT_LEGACY_DIVERGED],
    )
    expect(result.rows[0]).toMatchObject({
      status: 'closed',
      current_cycle_number: '1',
      receipt_status: 'applied',
      status_fact_count: 1,
    })
  })

  it('marks a delayed non-head observation obsolete without changing Inbox', async () => {
    const item = await seed()
    await insertObservation(live)
    const newer: Observation = {
      revision: 2,
      state: 'live',
      change: 'edited',
      resolution: 'diverged',
      provenance: 'external_or_unknown',
    }
    await insertObservation(newer)
    await seedDeliveryEvent(EVENT_STALE)
    expect(await applyObservation(item, EVENT_STALE, live)).toBe('obsolete')
    const row = await pool.query('SELECT status FROM inbox_items WHERE id = $1', [ITEM])
    expect(row.rows[0].status).toBe('open')
  })

  it('refuses a retained reply head after the current Review material revision advances', async () => {
    const item = await seed()
    await insertObservation(live)
    await seedDeliveryEvent(EVENT_REVIEW_ADVANCED)
    await insertMaterialRevision(2)

    expect(await applyObservation(item, EVENT_REVIEW_ADVANCED, live)).toBe('obsolete')
    const result = await pool.query(
      `SELECT i.status, r.status AS receipt_status
       FROM inbox_items i
       JOIN event_consumer_receipts r
         ON r.event_id = $2 AND r.consumer_name = 'inbox.on-reply-observed'
       WHERE i.id = $1`,
      [ITEM, EVENT_REVIEW_ADVANCED],
    )
    expect(result.rows[0]).toMatchObject({
      status: 'open',
      receipt_status: 'obsolete',
    })
  })

  it.each(['source_expired', 'provider_deleted'] as const)(
    'consumes and idempotently replays the identifier-only current head after %s erasure',
    async (erasedState) => {
      const item = await seed()
      await insertObservation(live)
      await seedDeliveryEvent(EVENT_LIVE)

      await getDb().transaction(async (tx) => {
        expect(
          await eraseReviewSourceContent(tx, {
            reviewId: REVIEW,
            organizationId: ORG,
            propertyId: PROPERTY,
            sourceEpoch: 0,
            expectedSourceRevision: 1,
            state: erasedState,
          }),
        ).toBe(true)
      })
      const redacted = await pool.query(
        `SELECT content_state, content_erased_at, normalized_text, normalized_digest
       FROM google_reply_observations
       WHERE organization_id = $1 AND review_id = $2 AND observation_revision = 1`,
        [ORG, REVIEW],
      )
      expect(redacted.rows[0]).toMatchObject({
        content_state: erasedState,
        normalized_text: null,
        normalized_digest: null,
      })
      expect(redacted.rows[0].content_erased_at).toBeInstanceOf(Date)

      expect(await applyObservation(item, EVENT_LIVE, live)).toBe('applied')
      expect(await applyObservation(item, EVENT_LIVE, live)).toBe('applied')
      const inbox = await pool.query('SELECT status FROM inbox_items WHERE id = $1', [
        ITEM,
      ])
      expect(inbox.rows[0].status).toBe('closed')
      const facts = await pool.query(
        `SELECT count(*)::int AS n FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'inbox.inbox_item.status_changed'`,
        [ORG],
      )
      expect(facts.rows[0].n).toBe(1)
    },
  )

  it('does not reopen a closed item from a deleted-reply observation after the Review source becomes ineligible', async () => {
    const item = await seed()
    await insertObservation(live)
    await seedDeliveryEvent(EVENT_LIVE)
    expect(await applyObservation(item, EVENT_LIVE, live)).toBe('applied')

    const deleted: Observation = {
      revision: 2,
      state: 'absent',
      change: 'deleted',
      resolution: 'absent',
      provenance: 'none',
    }
    await insertObservation(deleted)
    await getDb().transaction(async (tx) => {
      expect(
        await eraseReviewSourceContent(tx, {
          reviewId: REVIEW,
          organizationId: ORG,
          propertyId: PROPERTY,
          sourceEpoch: 0,
          expectedSourceRevision: 1,
          state: 'provider_deleted',
        }),
      ).toBe(true)
    })
    await seedDeliveryEvent(EVENT_INACTIVE_DELETED)

    expect(await applyObservation(item, EVENT_INACTIVE_DELETED, deleted)).toBe('applied')
    const inbox = await pool.query(
      `SELECT status, closed_at FROM inbox_items WHERE id = $1`,
      [ITEM],
    )
    expect(inbox.rows[0]).toMatchObject({ status: 'closed', closed_at: OBSERVED_AT })
    const cycles = await pool.query(
      `SELECT count(*)::int AS n FROM inbox_handling_cycles WHERE inbox_item_id = $1`,
      [ITEM],
    )
    expect(cycles.rows[0].n).toBe(1)
  })

  it('retries an exact current observation until its earlier review.created is projected', async () => {
    const item = await seed()
    await insertObservation(live)
    await seedDeliveryEvent(EVENT_LIVE)
    await pool.query('DELETE FROM inbox_items WHERE id = $1', [ITEM])
    const deps = consumerDeps()
    const event = observedEvent(EVENT_LIVE, live)

    await expect(handleInboxReplyObserved(deps, event)).rejects.toMatchObject({
      code: 'not_found',
    })
    const beforeProjection = await pool.query(
      `SELECT status FROM event_consumer_receipts
       WHERE event_id = $1 AND consumer_name = 'inbox.on-reply-observed'`,
      [EVENT_LIVE],
    )
    expect(beforeProjection.rows).toEqual([])

    await deps.commandStore.createItem(item, null, { materialReviewRevision: 1 })
    await expect(handleInboxReplyObserved(deps, event)).resolves.toEqual({
      status: 'applied',
    })
    const afterReplay = await pool.query(
      `SELECT i.status, r.status AS receipt_status
       FROM inbox_items i
       JOIN event_consumer_receipts r
         ON r.event_id = $2 AND r.consumer_name = 'inbox.on-reply-observed'
       WHERE i.id = $1`,
      [ITEM, EVENT_LIVE],
    )
    expect(afterReplay.rows[0]).toMatchObject({
      status: 'closed',
      receipt_status: 'applied',
    })
  })

  it('retries without a receipt until Inbox reaches the observation material revision', async () => {
    await seed()
    await insertMaterialRevision(2)
    const ahead = { ...live, materialReviewRevision: 2 }
    await insertObservation(ahead)
    await seedDeliveryEvent(EVENT_AHEAD)
    const deps = consumerDeps()
    const event = observedEvent(EVENT_AHEAD, ahead)

    await expect(handleInboxReplyObserved(deps, event)).rejects.toMatchObject({
      code: 'revision_conflict',
    })
    const beforeAdvance = await pool.query(
      `SELECT i.status, r.status AS receipt_status
       FROM inbox_items i
       LEFT JOIN event_consumer_receipts r
         ON r.event_id = $2 AND r.consumer_name = 'inbox.on-reply-observed'
       WHERE i.id = $1`,
      [ITEM, EVENT_AHEAD],
    )
    expect(beforeAdvance.rows[0]).toMatchObject({
      status: 'open',
      receipt_status: null,
    })

    const cycleHead = await deps.handlingCycleStore.findHead(ITEM, ORG)
    if (cycleHead === null) throw new Error('seeded Handling Cycle is missing')
    await deps.handlingCycleStore.startNext({
      inboxItemId: ITEM,
      organizationId: ORG,
      expected: {
        cycleNumber: cycleHead.currentCycleNumber,
        materialReviewRevision: cycleHead.currentMaterialReviewRevision,
        stateRevision: cycleHead.stateRevision,
      },
      materialReviewRevision: 2,
      openedReason: 'material_revision_changed',
      openedBy: null,
      openedAt: OBSERVED_AT,
      responseTarget: responseTargetPermit(2),
    })

    await expect(handleInboxReplyObserved(deps, event)).resolves.toEqual({
      status: 'applied',
    })
    const afterAdvance = await pool.query(
      `SELECT i.status, r.status AS receipt_status
       FROM inbox_items i
       JOIN event_consumer_receipts r
         ON r.event_id = $2 AND r.consumer_name = 'inbox.on-reply-observed'
       WHERE i.id = $1`,
      [ITEM, EVENT_AHEAD],
    )
    expect(afterAdvance.rows[0]).toMatchObject({
      status: 'closed',
      receipt_status: 'applied',
    })
  })

  it('receipts an exact current observation obsolete when Inbox is already newer', async () => {
    await seed()
    await insertObservation(live)
    await insertMaterialRevision(2)
    const deps = consumerDeps()
    const cycleHead = await deps.handlingCycleStore.findHead(ITEM, ORG)
    if (cycleHead === null) throw new Error('seeded Handling Cycle is missing')
    await deps.handlingCycleStore.startNext({
      inboxItemId: ITEM,
      organizationId: ORG,
      expected: {
        cycleNumber: cycleHead.currentCycleNumber,
        materialReviewRevision: cycleHead.currentMaterialReviewRevision,
        stateRevision: cycleHead.stateRevision,
      },
      materialReviewRevision: 2,
      openedReason: 'material_revision_changed',
      openedBy: null,
      openedAt: OBSERVED_AT,
      responseTarget: responseTargetPermit(2),
    })
    await seedDeliveryEvent(EVENT_OLDER)

    await expect(
      handleInboxReplyObserved(deps, observedEvent(EVENT_OLDER, live)),
    ).resolves.toEqual({ status: 'obsolete' })
    const result = await pool.query(
      `SELECT i.status, r.status AS receipt_status
       FROM inbox_items i
       JOIN event_consumer_receipts r
         ON r.event_id = $2 AND r.consumer_name = 'inbox.on-reply-observed'
       WHERE i.id = $1`,
      [ITEM, EVENT_OLDER],
    )
    expect(result.rows[0]).toMatchObject({
      status: 'open',
      receipt_status: 'obsolete',
    })
  })
})
