// Feed notification surface — which route facts the delivery-lag P1 waits on
// (real PostgreSQL).
//
// An import writes an `inbox.inbox_item.created` and an opened-with-item
// `inbox.handling_cycle.opened` fact for every past review, and a third, an
// `inbox.handling_cycle.closed` by the provider, for each one Google already
// shows a reply for. All three are notification routes, and none notifies
// anyone: history is never announced (ADR 0046), a revision the item was
// created with is covered by its arrival, and a close only settles notices.
// Counted as source facts awaiting delivery, a large import's queue wait paged
// notification.in-app-delivery-lag while no notice was owed.
//
// The source read spans every tenant, so the fixtures live in a recorded-at
// window no other suite writes into.

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId } from '#/shared/domain/ids'
import type { Database } from '#/shared/db'
import { createNotificationDeliveryLagRepository } from './notification-delivery-lag.repository'

const ORG = organizationId('f3b20000-0000-4000-8000-000000000001')
const OTHER_ORG = organizationId('f3b20000-0000-4000-8000-000000000002')
const PROPERTY = 'f3b20000-0000-4000-8000-000000000010'
const HISTORY_ITEM = 'f3b20000-0000-4000-8000-000000000020'
const HISTORY_REVIEW = 'f3b20000-0000-4000-8000-000000000021'
const LIVE_ITEM = 'f3b20000-0000-4000-8000-000000000030'
const MEASURED_ITEM = 'f3b20000-0000-4000-8000-000000000050'
const MEASURED_REVIEW = 'f3b20000-0000-4000-8000-000000000051'

const WINDOW_START = new Date('2018-05-11T05:00:00.000Z')
const RECORDED = new Date('2018-05-11T05:10:00.000Z')
const RECORDED_EARLIER = new Date('2018-05-11T05:05:00.000Z')
const RECORDED_LATER = new Date('2018-05-11T05:20:00.000Z')
const PUBLISHED = new Date('2012-07-07T10:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: ['outbox_events', 'inbox_items', 'reviews', 'properties'],
})

type ItemKind = Readonly<{
  itemId: string
  reviewId: string
  externalId: string
  eligibility: 'historical_onboarding' | 'measured'
}>

const HISTORY: ItemKind = {
  itemId: HISTORY_ITEM,
  reviewId: HISTORY_REVIEW,
  externalId: 'external-lag-silent',
  eligibility: 'historical_onboarding',
}

/** A review that arrived live: its first cycle's Response Target is measured. */
const MEASURED: ItemKind = {
  itemId: MEASURED_ITEM,
  reviewId: MEASURED_REVIEW,
  externalId: 'external-lag-measured',
  eligibility: 'measured',
}

async function seedProperty(): Promise<void> {
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, source_epoch)
     VALUES ($1, $2, 'Lag Silent Property', $3, 'UTC', 0)`,
    [PROPERTY, ORG, `property-${PROPERTY}`],
  )
}

/**
 * A Google Review Inbox item with its first Handling Cycle and that cycle's
 * Response Target. An import writes the target as `historical_onboarding`;
 * a review that arrived on its own is `measured`, with a due time.
 */
async function seedItem(kind: ItemKind): Promise<void> {
  const pool = getPool()
  const measured = kind.eligibility === 'measured'
  await pool.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id,
       external_location_id, rating, reviewed_at, expires_at,
       source_epoch, source_revision, source_observation_sequence,
       analysis_sequence, ai_source_byte_length, ai_source_digest,
       source_content_state, created_at, updated_at
     ) VALUES (
       $1, $2, $3, 'google', $4, 'locations/lag-silent', 4, $5,
       '2099-01-01T00:00:00Z', 0, 1, 0, 1, 1, $6, 'active', $7, $7
     )`,
    [kind.reviewId, ORG, PROPERTY, kind.externalId, PUBLISHED, '0'.repeat(64), RECORDED],
  )
  await pool.query(
    `INSERT INTO material_review_revisions (
       review_id, revision, organization_id, property_id, source_epoch,
       normalization_version, source_digest, normalized_digest, rating,
       normalized_text, response_target_eligibility, response_target_start_at,
       content_state, created_at, updated_at
     ) VALUES (
       $1, 1, $2, $3, 0, 'review-material-v1', $4, $4, 4,
       'lag silent review', $5, $6, 'active', $7, $7
     )`,
    [
      kind.reviewId,
      ORG,
      PROPERTY,
      '1'.repeat(64),
      kind.eligibility,
      measured ? RECORDED : null,
      RECORDED,
    ],
  )
  await pool.query(
    `INSERT INTO inbox_items
       (id, organization_id, property_id, source_type, source_id, source_date,
        platform, created_at, updated_at)
     VALUES ($1, $2, $3, 'review', $4, $5, 'google', $6, $6)`,
    [kind.itemId, ORG, PROPERTY, kind.reviewId, PUBLISHED, RECORDED],
  )
  await pool.query(
    `INSERT INTO inbox_handling_cycles
       (inbox_item_id, cycle_number, organization_id, property_id, source_type,
        source_id, source_revision, review_id, material_review_revision,
        opened_reason, opened_at, created_at)
     VALUES ($1, 1, $2, $3, 'review', $4, 1, $4, 1, 'review_observed', $5, $5)`,
    [kind.itemId, ORG, PROPERTY, kind.reviewId, RECORDED],
  )
  await pool.query(
    `INSERT INTO inbox_handling_cycle_response_targets
       (inbox_item_id, cycle_number, organization_id, property_id, source_type,
        source_id, source_revision, target_kind, performance_eligibility,
        duration_minutes, policy_source, policy_version, start_at, due_at,
        created_at, updated_at)
     VALUES ($1, 1, $2, $3, 'review', $4, 1, 'google_review_response', $5,
        $6, $7, $8, $9, $10, $11, $11)`,
    [
      kind.itemId,
      ORG,
      PROPERTY,
      kind.reviewId,
      kind.eligibility,
      measured ? 1440 : null,
      measured ? 'builtin_default' : null,
      measured ? 1 : null,
      measured ? RECORDED : null,
      measured ? new Date(RECORDED.getTime() + 1440 * 60_000) : null,
      RECORDED,
    ],
  )
}

/** A Google Review item an import brought in as history: cycle 1's target says so. */
async function seedHistoricalItem(): Promise<void> {
  await seedProperty()
  await seedItem(HISTORY)
}

/** A route fact whose notification consumer has not run yet. */
async function seedPendingFact(
  eventType: string,
  aggregateId: string,
  payload: Record<string, unknown>,
  recordedAt: Date = RECORDED,
): Promise<void> {
  await getPool().query(
    `INSERT INTO outbox_events
       (id, event_type, event_version, payload, organization_id, property_id,
        source_context, source_aggregate_id, created_at, published_at)
     VALUES ($1, $2, 1, $3, $4, $5, 'inbox', $6, $7, $7)`,
    [randomUUID(), eventType, payload, ORG, PROPERTY, aggregateId, recordedAt],
  )
}

/**
 * The payload of an `inbox.handling_cycle.closed` fact. By default the close an
 * import writes for a review Google already shows a reply for: cycle 1, closed
 * by the provider. A manager's close names the user instead.
 */
const closedPayload = (
  itemId: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> => ({
  inboxItemId: itemId,
  cycleNumber: 1,
  actorType: 'provider',
  userId: null,
  closeReason: 'external_reply_observed',
  source: 'import',
  ...overrides,
})

const MANAGER_CLOSE = {
  actorType: 'user',
  userId: 'f3b20000-0000-4000-8000-0000000000a1',
  closeReason: 'confirmed_on_google',
  source: 'web',
} as const

const readWithScanLimit = (scanLimit: number) =>
  createNotificationDeliveryLagRepository(
    drizzle(getPool()) as unknown as Database,
    () => true,
  ).read({
    recordedAtOrAfter: WINDOW_START,
    recordedBefore: new Date('2018-05-11T06:00:00.000Z'),
    scanLimit,
    statementTimeoutMs: 10_000,
  })

const read = () => readWithScanLimit(50)

describe('route facts the delivery-lag report waits on', () => {
  it('leaves out the facts an import writes that notify nobody', async () => {
    await seedHistoricalItem()
    // Owed a notice: a live arrival and a material revision of a known item.
    await seedPendingFact('inbox.inbox_item.created', LIVE_ITEM, {})
    await seedPendingFact('inbox.handling_cycle.opened', LIVE_ITEM, {
      openReason: 'material_revision_changed',
      sourceType: 'review',
      openedWithItem: false,
    })
    // Owed nothing: history's arrival, the cycle it was created with, the
    // provider's close of it for a review Google already answered, and a bulk
    // reopen's per-item facts (the completion fact announces them).
    await seedPendingFact('inbox.inbox_item.created', HISTORY_ITEM, {})
    await seedPendingFact('inbox.handling_cycle.opened', HISTORY_ITEM, {
      openReason: 'review_observed',
      sourceType: 'review',
      openedWithItem: true,
    })
    await seedPendingFact(
      'inbox.handling_cycle.closed',
      HISTORY_ITEM,
      closedPayload(HISTORY_ITEM),
    )
    await seedPendingFact('inbox.handling_cycle.opened', LIVE_ITEM, {
      openReason: 'material_revision_changed',
      sourceType: 'review',
      openedWithItem: true,
    })
    await seedPendingFact('inbox.handling_cycle.reopened', LIVE_ITEM, {
      reopenReason: 'manual_reopen',
      bulkId: 'f3b20000-0000-4000-8000-000000000040',
    })

    const report = await read()

    expect(report.sourceReceiptPending).toBe(2)
  })

  describe('a close of the first cycle of a history item', () => {
    it('is left out when the provider wrote it', async () => {
      await seedHistoricalItem()
      await seedPendingFact(
        'inbox.handling_cycle.closed',
        HISTORY_ITEM,
        closedPayload(HISTORY_ITEM),
      )

      const report = await read()

      expect(report.sourceReceiptPending).toBe(0)
    })

    it('is counted on an item that arrived live', async () => {
      await seedHistoricalItem()
      await seedItem(MEASURED)
      await seedPendingFact(
        'inbox.handling_cycle.closed',
        MEASURED_ITEM,
        closedPayload(MEASURED_ITEM),
      )

      const report = await read()

      expect(report.sourceReceiptPending).toBe(1)
    })

    it('is counted when a manager wrote it', async () => {
      await seedHistoricalItem()
      await seedPendingFact(
        'inbox.handling_cycle.closed',
        HISTORY_ITEM,
        closedPayload(HISTORY_ITEM, MANAGER_CLOSE),
      )

      const report = await read()

      expect(report.sourceReceiptPending).toBe(1)
    })

    it('is counted when it closes a later cycle', async () => {
      await seedHistoricalItem()
      await seedPendingFact(
        'inbox.handling_cycle.closed',
        HISTORY_ITEM,
        closedPayload(HISTORY_ITEM, { cycleNumber: 2 }),
      )

      const report = await read()

      expect(report.sourceReceiptPending).toBe(1)
    })
  })

  describe('the pending facts by route event type', () => {
    it('names how many of each are waiting, and leaves the silent ones out', async () => {
      await seedHistoricalItem()
      await seedItem(MEASURED)
      // Owed a notice: two live arrivals, a revision of a known item, a manager's close.
      await seedPendingFact('inbox.inbox_item.created', LIVE_ITEM, {})
      await seedPendingFact('inbox.inbox_item.created', MEASURED_ITEM, {})
      await seedPendingFact('inbox.handling_cycle.opened', LIVE_ITEM, {
        openReason: 'material_revision_changed',
        sourceType: 'review',
        openedWithItem: false,
      })
      await seedPendingFact(
        'inbox.handling_cycle.closed',
        HISTORY_ITEM,
        closedPayload(HISTORY_ITEM, MANAGER_CLOSE),
      )
      // Owed nothing: history's arrival and the provider's close of its first cycle.
      await seedPendingFact('inbox.inbox_item.created', HISTORY_ITEM, {})
      await seedPendingFact(
        'inbox.handling_cycle.closed',
        HISTORY_ITEM,
        closedPayload(HISTORY_ITEM),
      )

      const report = await read()

      expect(report.sourceReceiptPendingByEventType).toEqual({
        'inbox.inbox_item.created': 2,
        'inbox.handling_cycle.opened': 1,
        'inbox.handling_cycle.closed': 1,
      })
      expect(report.sourceReceiptPending).toBe(4)
    })

    it('times the oldest pending fact across every event type, not one group', async () => {
      // Three event types in name order: reopened, assigned, created. The oldest
      // fact sits in the middle one, so reading the first or the last group's
      // clock instead of the earliest of all would give a later time.
      await seedPendingFact(
        'inbox.handling_cycle.reopened',
        LIVE_ITEM,
        { reopenReason: 'manual_reopen' },
        RECORDED,
      )
      await seedPendingFact('inbox.inbox_item.assigned', LIVE_ITEM, {}, RECORDED_EARLIER)
      await seedPendingFact('inbox.inbox_item.created', LIVE_ITEM, {}, RECORDED_LATER)

      const report = await read()

      expect(report.sourceReceiptPendingByEventType).toEqual({
        'inbox.handling_cycle.reopened': 1,
        'inbox.inbox_item.assigned': 1,
        'inbox.inbox_item.created': 1,
      })
      expect(report.oldestSourceRecordedAt).toEqual(RECORDED_EARLIER)
    })

    it('is empty when nothing is waiting', async () => {
      const report = await read()

      expect(report.sourceReceiptPendingByEventType).toEqual({})
    })

    it('counts only the facts the capped scan held, and says it is capped', async () => {
      for (let arrival = 0; arrival < 3; arrival += 1) {
        await seedPendingFact('inbox.inbox_item.created', randomUUID(), {})
      }
      await seedPendingFact('inbox.handling_cycle.reopened', LIVE_ITEM, {
        reopenReason: 'manual_reopen',
      })

      const report = await readWithScanLimit(2)

      expect(report.sourceSaturated).toBe(true)
      expect(report.sourceReceiptPending).toBe(2)
      expect(
        Object.values(report.sourceReceiptPendingByEventType).reduce(
          (total, count) => total + count,
          0,
        ),
      ).toBe(2)
    })
  })
})
