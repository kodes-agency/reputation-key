import { describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { feedbackId, inboxItemId, organizationId, portalId } from '#/shared/domain/ids'
import type { Database } from '#/shared/db'
import { createInboxItemLookupAdapter } from './inbox-item-lookup.adapter'

const ORG_A = organizationId('b7100000-0000-4000-8000-000000000001')
const ORG_B = organizationId('b7100000-0000-4000-8000-000000000002')
const PROPERTY_A = 'b7100000-0000-4000-8000-000000000010'
const PROPERTY_B = 'b7100000-0000-4000-8000-000000000011'
const PORTAL_A = 'b7100000-0000-4000-8000-000000000020'
const PORTAL_B = 'b7100000-0000-4000-8000-000000000021'
const RESPONSE = 'b7100000-0000-4000-8000-000000000030'
const ITEM_A = inboxItemId('b7100000-0000-4000-8000-000000000040')
const ITEM_B = inboxItemId('b7100000-0000-4000-8000-000000000041')
const HISTORY_ITEM = inboxItemId('b7100000-0000-4000-8000-000000000050')
const HISTORY_REVIEW = 'b7100000-0000-4000-8000-000000000051'
const LIVE_ITEM = inboxItemId('b7100000-0000-4000-8000-000000000052')
const LIVE_REVIEW = 'b7100000-0000-4000-8000-000000000053'
const PUBLISHED = new Date('2012-07-07T10:00:00.000Z')
const OBSERVED = new Date('2026-09-16T20:40:00.000Z')
const GOOGLE_TARGET_MINUTES = 2880

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  // Guest tables are cleanup-only: earlier versions of this test seeded them,
  // and their Portal FKs must be cleared before the fixture Portal is deleted.
  // Reviews go after the cycles that pin their material revisions.
  // Response Targets are immutable and leave only with their cycle (cascade).
  tables: [
    'inbox_handling_cycle_transitions',
    'inbox_handling_cycle_heads',
    'inbox_handling_cycles',
    'inbox_items',
    'guest_responses',
    'feedback',
    'portals',
    'reviews',
    'properties',
  ],
})

async function seedPropertyAndPortal(
  organization: string,
  property: string,
  portal: string,
): Promise<void> {
  const pool = getPool()
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Recipient Property', $3, 'UTC')`,
    [property, organization, `property-${property}`],
  )
  await pool.query(
    `INSERT INTO portals
       (id, organization_id, property_id, entity_type, entity_id, name, slug)
     VALUES ($1, $2, $3::uuid, 'property', $3::text, 'Recipient Portal', $4)`,
    [portal, organization, property, `portal-${portal}`],
  )
}

async function seedInboxItem(
  id: string,
  organization: string,
  property: string,
  sourceId: string,
  assignedTo: string | null,
): Promise<void> {
  await getPool().query(
    `INSERT INTO inbox_items
       (id, organization_id, property_id, source_type, source_id, source_date,
        assigned_to, created_at, updated_at)
     VALUES ($1, $2, $3, 'feedback', $4, NOW(), $5, NOW(), NOW())`,
    [id, organization, property, sourceId, assignedTo],
  )
}

async function seedFeedbackHandlingCycle(
  id: string,
  organization: string,
  property: string,
  sourceId: string,
): Promise<void> {
  const pool = getPool()
  await pool.query(
    `INSERT INTO inbox_handling_cycles
       (inbox_item_id, cycle_number, organization_id, property_id, source_type,
        source_id, source_revision, opened_reason, opened_at)
     VALUES ($1, 1, $2, $3, 'feedback', $4, 1, 'feedback_submitted', NOW())`,
    [id, organization, property, sourceId],
  )
  await pool.query(
    `INSERT INTO inbox_handling_cycle_heads
       (inbox_item_id, organization_id, property_id, source_type, source_id,
        current_source_revision, current_cycle_number, state_revision, status)
     VALUES ($1, $2, $3, 'feedback', $4, 1, 1, 1, 'open')`,
    [id, organization, property, sourceId],
  )
}

/**
 * A Google Review item as the Inbox projection commits it: the Review's first
 * material revision, the item, its first Handling Cycle, and that cycle's
 * Response Target carrying Review's eligibility.
 */
async function seedReviewItem(
  id: string,
  review: string,
  eligibility: 'measured' | 'historical_onboarding',
): Promise<void> {
  const pool = getPool()
  const measured = eligibility === 'measured'
  await pool.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id,
       external_location_id, rating, reviewed_at, expires_at,
       source_epoch, source_revision, source_observation_sequence,
       analysis_sequence, ai_source_byte_length, ai_source_digest,
       source_content_state, created_at, updated_at
     ) VALUES (
       $1, $2, $3, 'google', $4, 'locations/inbox-item-lookup-test', 4, $5, $6,
       0, 1, 0, 1, 1, $7, 'active', $8, $8
     )`,
    [
      review,
      ORG_A,
      PROPERTY_A,
      `external-${review}`,
      PUBLISHED,
      new Date('2099-01-01T00:00:00.000Z'),
      '0'.repeat(64),
      OBSERVED,
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
       'inbox item lookup review', $5, $6, 'active', $7, $7
     )`,
    [
      review,
      ORG_A,
      PROPERTY_A,
      '1'.repeat(64),
      eligibility,
      measured ? PUBLISHED : null,
      OBSERVED,
    ],
  )
  await pool.query(
    `INSERT INTO inbox_items
       (id, organization_id, property_id, source_type, source_id, source_date,
        platform, created_at, updated_at)
     VALUES ($1, $2, $3, 'review', $4, $5, 'google', $6, $6)`,
    [id, ORG_A, PROPERTY_A, review, PUBLISHED, OBSERVED],
  )
  await pool.query(
    `INSERT INTO inbox_handling_cycles
       (inbox_item_id, cycle_number, organization_id, property_id, source_type,
        source_id, source_revision, review_id, material_review_revision,
        opened_reason, opened_at)
     VALUES ($1, 1, $2, $3, 'review', $4, 1, $4, 1, 'review_observed', $5)`,
    [id, ORG_A, PROPERTY_A, review, OBSERVED],
  )
  await pool.query(
    `INSERT INTO inbox_handling_cycle_response_targets
       (inbox_item_id, cycle_number, organization_id, property_id, source_type,
        source_id, source_revision, target_kind, performance_eligibility,
        duration_minutes, policy_source, policy_version, start_at, due_at)
     VALUES ($1, 1, $2, $3, 'review', $4, 1, 'google_review_response', $5,
        $6, $7, $8, $9, $10)`,
    [
      id,
      ORG_A,
      PROPERTY_A,
      review,
      eligibility,
      measured ? GOOGLE_TARGET_MINUTES : null,
      measured ? 'builtin_default' : null,
      measured ? 1 : null,
      measured ? PUBLISHED : null,
      measured ? new Date(PUBLISHED.getTime() + GOOGLE_TARGET_MINUTES * 60_000) : null,
    ],
  )
}

describe('createInboxItemLookupAdapter.findInboxItemFacts', () => {
  it('uses Guest-owned Portal attribution and returns the current assignee', async () => {
    await seedPropertyAndPortal(ORG_A, PROPERTY_A, PORTAL_A)
    await seedInboxItem(ITEM_A, ORG_A, PROPERTY_A, RESPONSE, 'manager-1')
    const findPortalId = vi.fn().mockResolvedValue(portalId(PORTAL_A))
    const lookup = createInboxItemLookupAdapter(
      drizzle(getPool()) as unknown as Database,
      { findPortalId },
    )

    await expect(lookup.findInboxItemFacts(ITEM_A, ORG_A)).resolves.toEqual(
      expect.objectContaining({
        propertyId: PROPERTY_A,
        portalId: PORTAL_A,
        assignedTo: 'manager-1',
        sourceType: 'feedback',
      }),
    )
    expect(findPortalId).toHaveBeenCalledWith(ORG_A, feedbackId(RESPONSE))
  })

  it('passes the Inbox Organization to attribution and preserves a null result', async () => {
    await seedPropertyAndPortal(ORG_B, PROPERTY_B, PORTAL_B)
    await seedInboxItem(ITEM_B, ORG_B, PROPERTY_B, RESPONSE, null)
    const findPortalId = vi.fn().mockResolvedValue(null)
    const lookup = createInboxItemLookupAdapter(
      drizzle(getPool()) as unknown as Database,
      { findPortalId },
    )

    await expect(lookup.findInboxItemFacts(ITEM_B, ORG_B)).resolves.toEqual(
      expect.objectContaining({ portalId: null, assignedTo: null }),
    )
    expect(findPortalId).toHaveBeenCalledWith(ORG_B, feedbackId(RESPONSE))
  })

  it('returns the exact current Handling Cycle fence with Portal attribution', async () => {
    await seedPropertyAndPortal(ORG_A, PROPERTY_A, PORTAL_A)
    await seedInboxItem(ITEM_A, ORG_A, PROPERTY_A, RESPONSE, null)
    await seedFeedbackHandlingCycle(ITEM_A, ORG_A, PROPERTY_A, RESPONSE)
    const lookup = createInboxItemLookupAdapter(
      drizzle(getPool()) as unknown as Database,
      { findPortalId: vi.fn().mockResolvedValue(portalId(PORTAL_A)) },
    )

    await expect(
      lookup.findHandlingCycleNotificationFacts(ITEM_A, ORG_A),
    ).resolves.toEqual(
      expect.objectContaining({
        propertyId: PROPERTY_A,
        portalId: PORTAL_A,
        sourceType: 'feedback',
        sourceId: RESPONSE,
        currentCycleNumber: 1,
        currentSourceRevision: 1,
        stateRevision: 1,
        status: 'open',
      }),
    )
  })
})

describe('createInboxItemLookupAdapter.isHistoricalOnboardingItem', () => {
  const lookup = () =>
    createInboxItemLookupAdapter(drizzle(getPool()) as unknown as Database, {
      findPortalId: vi.fn().mockResolvedValue(null),
    })

  it('recognises a review whose first Handling Cycle was observed as Google history', async () => {
    await seedPropertyAndPortal(ORG_A, PROPERTY_A, PORTAL_A)
    await seedReviewItem(HISTORY_ITEM, HISTORY_REVIEW, 'historical_onboarding')

    await expect(lookup().isHistoricalOnboardingItem(HISTORY_ITEM, ORG_A)).resolves.toBe(
      true,
    )
  })

  it('answers no for a live review, private feedback, another Organization, and a missing item', async () => {
    await seedPropertyAndPortal(ORG_A, PROPERTY_A, PORTAL_A)
    await seedReviewItem(HISTORY_ITEM, HISTORY_REVIEW, 'historical_onboarding')
    await seedReviewItem(LIVE_ITEM, LIVE_REVIEW, 'measured')
    await seedInboxItem(ITEM_A, ORG_A, PROPERTY_A, RESPONSE, null)
    await seedFeedbackHandlingCycle(ITEM_A, ORG_A, PROPERTY_A, RESPONSE)

    const adapter = lookup()
    const answers = await Promise.all([
      adapter.isHistoricalOnboardingItem(LIVE_ITEM, ORG_A),
      adapter.isHistoricalOnboardingItem(ITEM_A, ORG_A),
      adapter.isHistoricalOnboardingItem(HISTORY_ITEM, ORG_B),
      adapter.isHistoricalOnboardingItem(ITEM_B, ORG_A),
    ])

    expect(answers).toEqual([false, false, false, false])
  })
})

describe('createInboxItemLookupAdapter.countOpenReviewItemsForProperty', () => {
  const adapter = () =>
    createInboxItemLookupAdapter(drizzle(getPool()) as unknown as Database, {
      findPortalId: vi.fn().mockResolvedValue(null),
    })
  /** The open head the Inbox projection commits beside a Review's first cycle. */
  const seedOpenReviewHead = (item: string, review: string, status: 'open' | 'closed') =>
    getPool().query(
      `INSERT INTO inbox_handling_cycle_heads
         (inbox_item_id, organization_id, property_id, source_type, source_id,
          current_source_revision, current_cycle_number, state_revision, status)
       VALUES ($1, $2, $3, 'review', $4, 1, 1, 1, $5)`,
      [item, ORG_A, PROPERTY_A, review, status],
    )

  it('counts the imported reviews a Property still owes a reply', async () => {
    await seedPropertyAndPortal(ORG_A, PROPERTY_A, PORTAL_A)
    await seedReviewItem(HISTORY_ITEM, HISTORY_REVIEW, 'historical_onboarding')
    await seedReviewItem(LIVE_ITEM, LIVE_REVIEW, 'measured')
    await seedOpenReviewHead(HISTORY_ITEM, HISTORY_REVIEW, 'open')
    await seedOpenReviewHead(LIVE_ITEM, LIVE_REVIEW, 'open')

    await expect(
      adapter().countOpenReviewItemsForProperty(PROPERTY_A, ORG_A),
    ).resolves.toBe(2)
  })

  it('stops counting an item once its handling cycle is closed', async () => {
    await seedPropertyAndPortal(ORG_A, PROPERTY_A, PORTAL_A)
    await seedReviewItem(HISTORY_ITEM, HISTORY_REVIEW, 'historical_onboarding')
    await seedReviewItem(LIVE_ITEM, LIVE_REVIEW, 'measured')
    await seedOpenReviewHead(HISTORY_ITEM, HISTORY_REVIEW, 'closed')
    await seedOpenReviewHead(LIVE_ITEM, LIVE_REVIEW, 'open')

    await expect(
      adapter().countOpenReviewItemsForProperty(PROPERTY_A, ORG_A),
    ).resolves.toBe(1)
  })

  it('counts nothing for another Organization, or a Property with no reviews', async () => {
    await seedPropertyAndPortal(ORG_A, PROPERTY_A, PORTAL_A)
    await seedPropertyAndPortal(ORG_B, PROPERTY_B, PORTAL_B)
    await seedReviewItem(HISTORY_ITEM, HISTORY_REVIEW, 'historical_onboarding')
    await seedOpenReviewHead(HISTORY_ITEM, HISTORY_REVIEW, 'open')

    await expect(
      adapter().countOpenReviewItemsForProperty(PROPERTY_A, ORG_B),
    ).resolves.toBe(0)
    await expect(
      adapter().countOpenReviewItemsForProperty(PROPERTY_B, ORG_B),
    ).resolves.toBe(0)
  })
})

describe('createInboxItemLookupAdapter.findResponseTargetReminderNotificationFacts', () => {
  const OPENED = new Date('2026-09-16T08:00:00.000Z')
  const HALFWAY = new Date('2026-09-16T10:00:00.000Z')

  /** A measured four-hour feedback target whose halfway reminder was released. */
  async function seedReleasedHalfwayReminder(): Promise<void> {
    const pool = getPool()
    await pool.query(
      `INSERT INTO inbox_handling_cycle_response_targets
         (inbox_item_id, cycle_number, organization_id, property_id, source_type,
          source_id, source_revision, target_kind, performance_eligibility,
          duration_minutes, policy_source, policy_version, start_at, due_at)
       VALUES ($1, 1, $2, $3, 'feedback', $4, 1, 'private_feedback_handling',
          'measured', 240, 'builtin_default', 1, $5, $6)`,
      [
        ITEM_A,
        ORG_A,
        PROPERTY_A,
        RESPONSE,
        OPENED,
        new Date(OPENED.getTime() + 240 * 60_000),
      ],
    )
    await pool.query(
      `INSERT INTO inbox_response_target_reminders
         (inbox_item_id, cycle_number, reminder_kind, organization_id, property_id,
          target_kind, scheduled_for, delivered_at)
       VALUES ($1, 1, 'halfway', $2, $3, 'private_feedback_handling', $4, $4)`,
      [ITEM_A, ORG_A, PROPERTY_A, HALFWAY],
    )
  }

  const reminder = {
    inboxItemId: ITEM_A,
    organizationId: ORG_A,
    cycleNumber: 1,
    targetKind: 'private_feedback_handling',
    reminderKind: 'halfway',
    scheduledFor: HALFWAY,
  } as const

  it('stops answering once the Property is archived, so a released reminder notifies nobody', async () => {
    await seedPropertyAndPortal(ORG_A, PROPERTY_A, PORTAL_A)
    await seedInboxItem(ITEM_A, ORG_A, PROPERTY_A, RESPONSE, null)
    await seedFeedbackHandlingCycle(ITEM_A, ORG_A, PROPERTY_A, RESPONSE)
    await seedReleasedHalfwayReminder()
    const lookup = createInboxItemLookupAdapter(
      drizzle(getPool()) as unknown as Database,
      { findPortalId: vi.fn().mockResolvedValue(portalId(PORTAL_A)) },
    )

    await expect(
      lookup.findResponseTargetReminderNotificationFacts(reminder),
    ).resolves.toEqual(
      expect.objectContaining({
        propertyId: PROPERTY_A,
        reminderKind: 'halfway',
        scheduledFor: HALFWAY,
        status: 'open',
      }),
    )

    await getPool().query(
      `UPDATE properties SET lifecycle_state = 'archived' WHERE id = $1`,
      [PROPERTY_A],
    )

    await expect(
      lookup.findResponseTargetReminderNotificationFacts(reminder),
    ).resolves.toBeNull()
  })
})

/** A measured private-feedback target on cycle 1, started `startAt`. */
async function seedMeasuredTarget(
  id: string,
  organization: string,
  property: string,
  sourceId: string,
  startAt: Date,
): Promise<void> {
  await getPool().query(
    `INSERT INTO inbox_handling_cycle_response_targets
       (inbox_item_id, cycle_number, organization_id, property_id, source_type,
        source_id, source_revision, target_kind, performance_eligibility,
        duration_minutes, policy_source, policy_version, start_at, due_at)
     VALUES ($1, 1, $2, $3, 'feedback', $4, 1, 'private_feedback_handling',
             'measured', 60, 'builtin_default', 1, $5,
             $5::timestamptz + interval '60 minutes')`,
    [id, organization, property, sourceId, startAt],
  )
}

describe('createInboxItemLookupAdapter.findWaitingSince', () => {
  const STARTED = new Date('2026-09-20T09:00:00.000Z')
  const lookup = () =>
    createInboxItemLookupAdapter(drizzle(getPool()) as unknown as Database, {
      findPortalId: vi.fn().mockResolvedValue(portalId(PORTAL_A)),
    })

  const seedWaitingItem = async () => {
    await seedPropertyAndPortal(ORG_A, PROPERTY_A, PORTAL_A)
    await seedInboxItem(ITEM_A, ORG_A, PROPERTY_A, RESPONSE, null)
    await seedFeedbackHandlingCycle(ITEM_A, ORG_A, PROPERTY_A, RESPONSE)
    await seedMeasuredTarget(ITEM_A, ORG_A, PROPERTY_A, RESPONSE, STARTED)
  }

  it("starts the wait at the current cycle's Response Target, not at the item", async () => {
    await seedWaitingItem()

    await expect(lookup().findWaitingSince(ITEM_A, ORG_A)).resolves.toEqual(STARTED)
  })

  it('finds nothing waiting once the target is met', async () => {
    await seedWaitingItem()
    await getPool().query(
      `UPDATE inbox_handling_cycle_response_targets
          SET completion_at = start_at + interval '10 minutes', result = 'on_time',
              stop_reason = 'private_feedback_handled'
        WHERE inbox_item_id = $1`,
      [ITEM_A],
    )

    await expect(lookup().findWaitingSince(ITEM_A, ORG_A)).resolves.toBeNull()
  })

  it('finds nothing waiting on a closed item', async () => {
    await seedWaitingItem()
    await getPool().query(
      `UPDATE inbox_handling_cycle_heads SET status = 'closed' WHERE inbox_item_id = $1`,
      [ITEM_A],
    )

    await expect(lookup().findWaitingSince(ITEM_A, ORG_A)).resolves.toBeNull()
  })

  it("never reads another Organization's item", async () => {
    await seedWaitingItem()

    await expect(lookup().findWaitingSince(ITEM_A, ORG_B)).resolves.toBeNull()
  })
})
