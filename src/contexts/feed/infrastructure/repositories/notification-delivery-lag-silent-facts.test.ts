// Feed notification surface — which route facts the delivery-lag P1 waits on
// (real PostgreSQL).
//
// An import writes an `inbox.inbox_item.created` and an opened-with-item
// `inbox.handling_cycle.opened` fact for every past review. Both are
// notification routes, and neither notifies anyone: history is never
// announced (ADR 0046) and a revision the item was created with is covered by
// its arrival. Counted as source facts awaiting delivery, a large import's
// queue wait paged notification.in-app-delivery-lag while no notice was owed.
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

const WINDOW_START = new Date('2018-05-11T05:00:00.000Z')
const RECORDED = new Date('2018-05-11T05:10:00.000Z')
const PUBLISHED = new Date('2012-07-07T10:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: ['outbox_events', 'inbox_items', 'reviews', 'properties'],
})

/** A Google Review item an import brought in as history: cycle 1's target says so. */
async function seedHistoricalItem(): Promise<void> {
  const pool = getPool()
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, source_epoch)
     VALUES ($1, $2, 'Lag Silent Property', $3, 'UTC', 0)`,
    [PROPERTY, ORG, `property-${PROPERTY}`],
  )
  await pool.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id,
       external_location_id, rating, reviewed_at, expires_at,
       source_epoch, source_revision, source_observation_sequence,
       analysis_sequence, ai_source_byte_length, ai_source_digest,
       source_content_state, created_at, updated_at
     ) VALUES (
       $1, $2, $3, 'google', 'external-lag-silent', 'locations/lag-silent', 4, $4,
       '2099-01-01T00:00:00Z', 0, 1, 0, 1, 1, $5, 'active', $6, $6
     )`,
    [HISTORY_REVIEW, ORG, PROPERTY, PUBLISHED, '0'.repeat(64), RECORDED],
  )
  await pool.query(
    `INSERT INTO material_review_revisions (
       review_id, revision, organization_id, property_id, source_epoch,
       normalization_version, source_digest, normalized_digest, rating,
       normalized_text, response_target_eligibility, response_target_start_at,
       content_state, created_at, updated_at
     ) VALUES (
       $1, 1, $2, $3, 0, 'review-material-v1', $4, $4, 4,
       'lag silent review', 'historical_onboarding', NULL, 'active', $5, $5
     )`,
    [HISTORY_REVIEW, ORG, PROPERTY, '1'.repeat(64), RECORDED],
  )
  await pool.query(
    `INSERT INTO inbox_items
       (id, organization_id, property_id, source_type, source_id, source_date,
        platform, created_at, updated_at)
     VALUES ($1, $2, $3, 'review', $4, $5, 'google', $6, $6)`,
    [HISTORY_ITEM, ORG, PROPERTY, HISTORY_REVIEW, PUBLISHED, RECORDED],
  )
  await pool.query(
    `INSERT INTO inbox_handling_cycles
       (inbox_item_id, cycle_number, organization_id, property_id, source_type,
        source_id, source_revision, review_id, material_review_revision,
        opened_reason, opened_at, created_at)
     VALUES ($1, 1, $2, $3, 'review', $4, 1, $4, 1, 'review_observed', $5, $5)`,
    [HISTORY_ITEM, ORG, PROPERTY, HISTORY_REVIEW, RECORDED],
  )
  await pool.query(
    `INSERT INTO inbox_handling_cycle_response_targets
       (inbox_item_id, cycle_number, organization_id, property_id, source_type,
        source_id, source_revision, target_kind, performance_eligibility,
        created_at, updated_at)
     VALUES ($1, 1, $2, $3, 'review', $4, 1, 'google_review_response',
        'historical_onboarding', $5, $5)`,
    [HISTORY_ITEM, ORG, PROPERTY, HISTORY_REVIEW, RECORDED],
  )
}

/** A route fact whose notification consumer has not run yet. */
async function seedPendingFact(
  eventType: string,
  aggregateId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await getPool().query(
    `INSERT INTO outbox_events
       (id, event_type, event_version, payload, organization_id, property_id,
        source_context, source_aggregate_id, created_at, published_at)
     VALUES ($1, $2, 1, $3, $4, $5, 'inbox', $6, $7, $7)`,
    [randomUUID(), eventType, payload, ORG, PROPERTY, aggregateId, RECORDED],
  )
}

const read = () =>
  createNotificationDeliveryLagRepository(
    drizzle(getPool()) as unknown as Database,
    () => true,
  ).read({
    recordedAtOrAfter: WINDOW_START,
    recordedBefore: new Date('2018-05-11T06:00:00.000Z'),
    scanLimit: 50,
    statementTimeoutMs: 10_000,
  })

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
    // Owed nothing: history's arrival, the cycle it was created with, and a
    // bulk reopen's per-item facts (the completion fact announces them).
    await seedPendingFact('inbox.inbox_item.created', HISTORY_ITEM, {})
    await seedPendingFact('inbox.handling_cycle.opened', HISTORY_ITEM, {
      openReason: 'review_observed',
      sourceType: 'review',
      openedWithItem: true,
    })
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
})
