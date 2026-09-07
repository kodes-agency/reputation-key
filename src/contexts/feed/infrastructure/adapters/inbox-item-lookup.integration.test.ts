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

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  // Guest tables are cleanup-only: earlier versions of this test seeded them,
  // and their Portal FKs must be cleared before the fixture Portal is deleted.
  tables: [
    'inbox_handling_cycle_transitions',
    'inbox_handling_cycle_heads',
    'inbox_handling_cycles',
    'inbox_items',
    'guest_responses',
    'feedback',
    'portals',
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
