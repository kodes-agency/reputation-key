// Feed notification surface — the notification-gap read against PostgreSQL.
//
// The unit test pins the rendered predicate; this one proves the rules only a
// real database can. An item an import brought in as Google history is never
// a gap, because the fan-out never announces it (ADR 0046); were it a gap, the
// missing-notification alert would page after every import. And an item whose
// delivery settled without a notification — every recipient muted it, or no
// longer qualified — is not a gap either; were it one, the alert would page
// for a correct outcome and stay firing for a day.
//
// The gap read deliberately spans every tenant, so the fixtures live in a
// created_at window no other suite writes into.

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId } from '#/shared/domain/ids'
import type { Database } from '#/shared/db'
import { createNotificationGapRepository } from './notification-gap.repository'

const ORG = organizationId('f3a10000-0000-4000-8000-000000000001')
const OTHER_ORG = organizationId('f3a10000-0000-4000-8000-000000000002')
const PROPERTY = 'f3a10000-0000-4000-8000-000000000010'
const HISTORY_ITEM = 'f3a10000-0000-4000-8000-000000000020'
const HISTORY_REVIEW = 'f3a10000-0000-4000-8000-000000000021'
const LIVE_ITEM = 'f3a10000-0000-4000-8000-000000000030'
const LIVE_REVIEW = 'f3a10000-0000-4000-8000-000000000031'
const LEGACY_ITEM = 'f3a10000-0000-4000-8000-000000000040'
const LEGACY_REVIEW = 'f3a10000-0000-4000-8000-000000000041'
const FEEDBACK_ITEM = 'f3a10000-0000-4000-8000-000000000050'
const FEEDBACK = 'f3a10000-0000-4000-8000-000000000051'

const WINDOW = {
  createdAtOrAfter: new Date('2019-03-07T05:00:00.000Z'),
  createdBefore: new Date('2019-03-07T06:00:00.000Z'),
}
const PUBLISHED = new Date('2012-07-07T10:00:00.000Z')
const GOOGLE_TARGET_MINUTES = 2880

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  // inbox_items first: its cascade removes the cycles that pin each Review's
  // material revision, and the Response Targets with them. Receipts go with
  // their outbox facts.
  tables: ['outbox_events', 'inbox_items', 'reviews', 'properties'],
})

const minutesAfter = (instant: Date, minutes: number): Date =>
  new Date(instant.getTime() + minutes * 60_000)

type Eligibility = 'measured' | 'historical_onboarding' | 'legacy_unknown'

async function seedReviewSource(review: string, eligibility: Eligibility): Promise<void> {
  const pool = getPool()
  await pool.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id,
       external_location_id, rating, reviewed_at, expires_at,
       source_epoch, source_revision, source_observation_sequence,
       analysis_sequence, ai_source_byte_length, ai_source_digest,
       source_content_state, created_at, updated_at
     ) VALUES (
       $1, $2, $3, 'google', $4, 'locations/notification-gap-test', 4, $5, $6,
       0, 1, 0, 1, 1, $7, 'active', $8, $8
     )`,
    [
      review,
      ORG,
      PROPERTY,
      `external-${review}`,
      PUBLISHED,
      new Date('2099-01-01T00:00:00.000Z'),
      '0'.repeat(64),
      WINDOW.createdAtOrAfter,
    ],
  )
  await pool.query(
    `INSERT INTO material_review_revisions (
       review_id, revision, organization_id, property_id, source_epoch,
       normalization_version, source_digest, normalized_digest, rating,
       normalized_text, response_target_eligibility, response_target_start_at,
       content_state, created_at, updated_at
     ) VALUES (
       $1, 1, $2, $3, 0, 'review-material-v1', $4, $4, 4,
       'notification gap review', $5, $6, 'active', $7, $7
     )`,
    [
      review,
      ORG,
      PROPERTY,
      '1'.repeat(64),
      eligibility,
      eligibility === 'measured' ? PUBLISHED : null,
      WINDOW.createdAtOrAfter,
    ],
  )
}

/**
 * A Google Review item as the Inbox projection commits it: the item, its first
 * Handling Cycle on material revision 1, and that cycle's Response Target
 * carrying Review's eligibility, all at the instant Review observed it.
 */
async function seedReviewItem(
  item: string,
  review: string,
  eligibility: Eligibility,
  observedAt: Date,
): Promise<void> {
  const pool = getPool()
  const measured = eligibility === 'measured'
  await seedReviewSource(review, eligibility)
  await pool.query(
    `INSERT INTO inbox_items
       (id, organization_id, property_id, source_type, source_id, source_date,
        platform, created_at, updated_at)
     VALUES ($1, $2, $3, 'review', $4, $5, 'google', $6, $6)`,
    [item, ORG, PROPERTY, review, PUBLISHED, observedAt],
  )
  await pool.query(
    `INSERT INTO inbox_handling_cycles
       (inbox_item_id, cycle_number, organization_id, property_id, source_type,
        source_id, source_revision, review_id, material_review_revision,
        opened_reason, opened_at, created_at)
     VALUES ($1, 1, $2, $3, 'review', $4, 1, $4, 1, 'review_observed', $5, $5)`,
    [item, ORG, PROPERTY, review, observedAt],
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
      item,
      ORG,
      PROPERTY,
      review,
      eligibility,
      measured ? GOOGLE_TARGET_MINUTES : null,
      measured ? 'builtin_default' : null,
      measured ? 1 : null,
      measured ? PUBLISHED : null,
      measured ? minutesAfter(PUBLISHED, GOOGLE_TARGET_MINUTES) : null,
      observedAt,
    ],
  )
}

/** Four items, none of which has a notification yet. */
async function seedImportedAndLiveItems(): Promise<void> {
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, source_epoch)
     VALUES ($1, $2, 'Gap Property', $3, 'UTC', 0)`,
    [PROPERTY, ORG, `property-${PROPERTY}`],
  )
  await seedReviewItem(
    HISTORY_ITEM,
    HISTORY_REVIEW,
    'historical_onboarding',
    minutesAfter(WINDOW.createdAtOrAfter, 10),
  )
  await seedReviewItem(
    LIVE_ITEM,
    LIVE_REVIEW,
    'measured',
    minutesAfter(WINDOW.createdAtOrAfter, 11),
  )
  await seedReviewItem(
    LEGACY_ITEM,
    LEGACY_REVIEW,
    'legacy_unknown',
    minutesAfter(WINDOW.createdAtOrAfter, 12),
  )
  const feedbackAt = minutesAfter(WINDOW.createdAtOrAfter, 13)
  await getPool().query(
    `INSERT INTO inbox_items
       (id, organization_id, property_id, source_type, source_id, source_date,
        created_at, updated_at)
     VALUES ($1, $2, $3, 'feedback', $4, $5, $5, $5)`,
    [FEEDBACK_ITEM, ORG, PROPERTY, FEEDBACK, feedbackAt],
  )
}

const ARRIVAL_CONSUMER = 'notification.on-inbox-item-created'

type Delivery = 'consumer_pending' | 'unsettled' | 'applied' | 'obsolete'

/**
 * Inbox's arrival fact for an item and the receipts its Feed delivery left:
 * none yet, a delivery Redis accepted that never settled, or one that settled
 * applied or obsolete without writing a notification.
 */
async function seedArrivalDelivery(item: string, delivery: Delivery): Promise<void> {
  const pool = getPool()
  const event = randomUUID()
  await pool.query(
    `INSERT INTO outbox_events
       (id, event_type, event_version, payload, organization_id, property_id,
        source_context, source_aggregate_id, created_at, published_at)
     VALUES ($1, 'inbox.inbox_item.created', 1, '{}', $2, $3, 'inbox', $4, $5, $5)`,
    [event, ORG, PROPERTY, item, WINDOW.createdAtOrAfter],
  )
  if (delivery === 'consumer_pending') return
  await pool.query(
    `INSERT INTO event_consumer_receipts (event_id, consumer_name, status)
     VALUES ($1, $2, 'applied'), ($1, $3, 'applied')`,
    [event, ARRIVAL_CONSUMER, `notification.enqueue:${ARRIVAL_CONSUMER}:delivery-1`],
  )
  if (delivery === 'unsettled') return
  await pool.query(
    `INSERT INTO event_consumer_receipts (event_id, consumer_name, status)
     VALUES ($1, $2, $3)`,
    [event, `notification.materialized:${ARRIVAL_CONSUMER}:delivery-1`, delivery],
  )
}

const gapRepository = () =>
  createNotificationGapRepository(drizzle(getPool()) as unknown as Database)

describe('notification gap repository against PostgreSQL', () => {
  it('leaves imported history out of the missing-notification gauge', async () => {
    await seedImportedAndLiveItems()

    await expect(
      gapRepository().countItemsMissingNotifications({ ...WINDOW, scanLimit: 1000 }),
    ).resolves.toBe(3)
  })

  it('counts an item while its delivery is pending, whether the consumer or the insert has not run', async () => {
    await seedImportedAndLiveItems()
    await seedArrivalDelivery(LIVE_ITEM, 'consumer_pending')
    await seedArrivalDelivery(LEGACY_ITEM, 'unsettled')

    await expect(
      gapRepository().countItemsMissingNotifications({ ...WINDOW, scanLimit: 1000 }),
    ).resolves.toBe(3)
  })

  it.each(['applied', 'obsolete'] as const)(
    'stops counting an item whose delivery settled %s without a notification',
    async (settlement) => {
      await seedImportedAndLiveItems()
      await seedArrivalDelivery(LIVE_ITEM, settlement)

      await expect(
        gapRepository().countItemsMissingNotifications({ ...WINDOW, scanLimit: 1000 }),
      ).resolves.toBe(2)
    },
  )
})
