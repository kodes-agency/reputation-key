import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import type { ConsumerEvent } from '#/shared/outbox'
import { inboxItemId, organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { createReviewResponseTargetAuthority } from '#/contexts/review/infrastructure/response-target-authority'
import { createReviewResponseTargetAuthorityAdapter } from './adapters/review-response-target-authority.adapter'
import { createAtomicInboxCommandStore } from './inbox-command-store'
import { createInboxRepository } from './repositories/inbox.repository'
import { createReviewHandlingCycleStore } from './review-handling-cycle.store'
import {
  handleInboxReviewCreated,
  handleInboxReviewUpdated,
  type InboxConsumerDeps,
} from './outbox-consumers'

/**
 * Archive/Restore, a Google relink and disconnect/reconnect advance the source
 * epoch; the next sync carries each unchanged Review into it as its next Material
 * Revision. That carry is no guest edit, but a real edit after it must still
 * reach the Inbox. */
const ORG = organizationId('org-inbox-projection-epoch-carry')
const OTHER_ORG = organizationId('org-inbox-projection-epoch-carry-b')
const PROPERTY = propertyId('7d000000-0000-4000-8000-000000000001')
const REVIEW = reviewId('7d000000-0000-4000-8000-000000000002')
const ITEM = inboxItemId('7d000000-0000-4000-8000-000000000003')
const OBSERVED = {
  1: new Date('2026-08-01T12:00:00.000Z'),
  2: new Date('2026-08-02T12:00:00.000Z'),
  3: new Date('2026-08-03T12:00:00.000Z'),
} as const
const DELIVERED_AT = new Date('2026-08-20T12:00:00.000Z')
const ORIGINAL = 'a'.repeat(64)
const EDITED = 'b'.repeat(64)

// Deleting a source event cascades its consumer receipts.
const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: [
    'inbox_items',
    'outbox_events',
    'material_review_revisions',
    'reviews',
    'properties',
  ],
})

const event = (
  kind: 'review.created' | 'review.updated',
  sourceEpoch: number,
  revision: 1 | 2 | 3,
): ConsumerEvent => ({
  eventId: `7d000000-0000-4000-8000-0000000000${sourceEpoch}${revision}`,
  eventType: kind,
  eventVersion: 1,
  payload: {
    reviewId: REVIEW,
    organizationId: ORG,
    propertyId: PROPERTY,
    platform: 'google',
    sourceEpoch,
    sourceRevision: revision,
    analysisSequence: revision,
    occurredAt: OBSERVED[revision].toISOString(),
  },
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceContext: 'review',
  sourceAggregateId: REVIEW,
})

/** Review records one numbered Material Revision in the given source epoch. */
async function observeRevision(
  revision: 1 | 2 | 3,
  sourceEpoch: number,
  digest: string,
): Promise<void> {
  await getPool().query(
    `INSERT INTO material_review_revisions (
       review_id, revision, organization_id, property_id, source_epoch,
       normalization_version, source_digest, normalized_digest, rating,
       normalized_text, response_target_eligibility, response_target_start_at,
       content_state, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, 'review-material-v1', $6, $6, 4,
       'review text', 'measured', $7, 'active', $7, $7
     )`,
    [REVIEW, revision, ORG, PROPERTY, sourceEpoch, digest, OBSERVED[revision]],
  )
  await getPool().query(
    `UPDATE reviews
     SET source_epoch = $2, source_revision = $3, source_observation_sequence = $3,
         analysis_sequence = $3, last_fetched_at = $4
     WHERE id = $1`,
    [REVIEW, sourceEpoch, revision, OBSERVED[revision]],
  )
}

/** Archive/Restore or relink: the Property moves to a newer source epoch. */
const advancePropertyEpoch = (epoch: number) =>
  getPool().query('UPDATE properties SET source_epoch = $2 WHERE id = $1', [
    PROPERTY,
    epoch,
  ])

async function seedReview(): Promise<void> {
  await getPool().query(
    `INSERT INTO properties (
       id, organization_id, name, slug, timezone, source_epoch, created_at, updated_at
     ) VALUES ($1, $2, 'Epoch carry property', $3, 'UTC', 0, NOW(), NOW())`,
    [PROPERTY, ORG, `inbox-epoch-carry-${process.pid}`],
  )
  await getPool().query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id,
       external_location_id, rating, reviewed_at, expires_at,
       source_created_at, first_fetched_at, last_fetched_at,
       content_expires_at, source_epoch, source_revision,
       source_observation_sequence, analysis_sequence, ai_source_byte_length,
       ai_source_digest, source_content_state, created_at, updated_at
     ) VALUES (
       $1, $2, $3, 'google', 'epoch-carry-review', 'locations/epoch-carry', 4, $4,
       $5, $4, $4, $4, $5, 0, 1, 1, 1, 1, $6, 'active', $4, $4
     )`,
    [REVIEW, ORG, PROPERTY, OBSERVED[1], new Date('2027-08-01T12:00:00.000Z'), ORIGINAL],
  )
  await observeRevision(1, 0, ORIGINAL)
}

const obsolete = { withExactCurrent: async () => ({ status: 'obsolete' as const }) }
const lookups = {
  reviewLookup: {
    getReviewSnippetById: async () => ({ status: 'not_found' as const }),
    getReviewSnippetsByIds: async () => new Map(),
    findEligibleReviewIds: async () => [],
  },
  feedbackLookup: {
    getFeedbackSnippetById: async () => null,
    getFeedbackSnippetsByIds: async () => new Map(),
    findEligibleFeedbackIds: async () => [],
  },
  propertyLookup: {
    getPropertyNameById: async () => null,
    getPropertyNamesByIds: async () => new Map(),
  },
}

function deps(): InboxConsumerDeps {
  const database = getDb()
  const clock = () => DELIVERED_AT
  return {
    commandStore: createAtomicInboxCommandStore(
      database,
      async () => ({ allowed: true }),
      clock,
    ),
    handlingCycleStore: createReviewHandlingCycleStore(database),
    replyObservationAuthority: obsolete,
    responseTargetAuthority: createReviewResponseTargetAuthorityAdapter(
      createReviewResponseTargetAuthority(database),
    ),
    sourceTransitionAuthority: obsolete,
    reviewLookup: lookups.reviewLookup,
    reviewSourceLookup: {
      getReviewSourceMetaById: async () => null,
      getReviewSourceMetaByIds: async () => [],
      listReviewSources: async () => [],
    },
    inboxRepo: createInboxRepository(database, lookups, {
      clock,
      logger: createMockLogger(),
    }),
    idGen: () => ITEM,
    clock,
    logger: createMockLogger(),
  }
}

/** Receipts reference the durable source event, so it is recorded first. */
async function deliver(candidate: ConsumerEvent) {
  await getPool().query(
    `INSERT INTO outbox_events (
       id, event_type, event_version, payload, organization_id,
       property_id, source_context, source_aggregate_id, created_at
     ) VALUES ($1, $2, 1, $3::jsonb, $4, $5, 'review', $6, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [candidate.eventId, candidate.eventType, candidate.payload, ORG, PROPERTY, REVIEW],
  )
  return candidate.eventType === 'review.created'
    ? handleInboxReviewCreated(deps(), candidate)
    : handleInboxReviewUpdated(deps(), candidate)
}

async function projection() {
  const [cycles, head, opened] = await Promise.all([
    getPool().query(
      `SELECT cycle_number::int AS "cycleNumber", source_revision::int AS "sourceRevision"
       FROM inbox_handling_cycles WHERE organization_id = $1 ORDER BY cycle_number`,
      [ORG],
    ),
    getPool().query(
      `SELECT current_cycle_number::int AS "cycleNumber",
              current_source_revision::int AS "sourceRevision",
              current_material_review_revision::int AS "materialRevision", status
       FROM inbox_handling_cycle_heads WHERE organization_id = $1`,
      [ORG],
    ),
    getPool().query(
      `SELECT (payload->>'cycleNumber')::int AS "cycleNumber",
              payload->'openedWithItem' AS "openedWithItem"
       FROM outbox_events
       WHERE organization_id = $1
         AND event_type = 'inbox.handling_cycle.opened'
         AND payload->>'openReason' = 'material_revision_changed'
       ORDER BY 1`,
      [ORG],
    ),
  ])
  return { cycles: cycles.rows, head: head.rows, revisionChanges: opened.rows }
}

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await seedReview()
})

describe.sequential('Inbox projection across a source-epoch change', () => {
  it('advances past the carry without opening a Handling Cycle', async () => {
    await deliver(event('review.created', 0, 1))
    await advancePropertyEpoch(1)
    await observeRevision(2, 1, ORIGINAL)

    await expect(deliver(event('review.updated', 1, 2))).resolves.toEqual({
      status: 'applied',
    })

    expect(await projection()).toEqual({
      cycles: [{ cycleNumber: 1, sourceRevision: 1 }],
      head: [{ cycleNumber: 1, sourceRevision: 2, materialRevision: 2, status: 'open' }],
      revisionChanges: [],
    })
  })

  it('opens a Handling Cycle for a guest edit made after the carry', async () => {
    await deliver(event('review.created', 0, 1))
    await advancePropertyEpoch(1)
    await observeRevision(2, 1, ORIGINAL)
    await deliver(event('review.updated', 1, 2))
    await observeRevision(3, 1, EDITED)

    await expect(deliver(event('review.updated', 1, 3))).resolves.toEqual({
      status: 'applied',
    })

    expect(await projection()).toEqual({
      cycles: [
        { cycleNumber: 1, sourceRevision: 1 },
        { cycleNumber: 2, sourceRevision: 3 },
      ],
      head: [{ cycleNumber: 2, sourceRevision: 3, materialRevision: 3, status: 'open' }],
      revisionChanges: [{ cycleNumber: 2, openedWithItem: false }],
    })
  })

  it('opens a Handling Cycle for a guest edit first seen in the new epoch', async () => {
    await deliver(event('review.created', 0, 1))
    await advancePropertyEpoch(1)
    await observeRevision(2, 1, EDITED)

    await deliver(event('review.updated', 1, 2))

    expect(await projection()).toMatchObject({
      cycles: [
        { cycleNumber: 1, sourceRevision: 1 },
        { cycleNumber: 2, sourceRevision: 2 },
      ],
      revisionChanges: [{ cycleNumber: 2, openedWithItem: false }],
    })
  })

  it('projects a Review first seen after the carry as one item, not as a change', async () => {
    await advancePropertyEpoch(1)
    await observeRevision(2, 1, ORIGINAL)

    await deliver(event('review.updated', 1, 2))
    await deliver(event('review.created', 0, 1))

    expect(await projection()).toEqual({
      cycles: [{ cycleNumber: 1, sourceRevision: 1 }],
      head: [{ cycleNumber: 1, sourceRevision: 2, materialRevision: 2, status: 'open' }],
      revisionChanges: [],
    })
  })
})
