// The grouped close fact an assignment release records, against the real
// database.
//
// Closing an item never clears its assignee, so a departing manager still
// holds every item they ever handled. Releasing them all is right — nothing
// should stay assigned to someone who left — but the grouped fact is what
// tells the Property's managers that work was left without an owner, and
// handled work is not that.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem } from '../../domain/types'
import { createAtomicInboxCommandStore } from '../inbox-command-store'

const ORG = organizationId('org-inbox-release-grouping-11111111')
const OPEN_PROPERTY = propertyId('4e000000-0000-4000-8000-000000000001')
const HANDLED_PROPERTY = propertyId('4e000000-0000-4000-8000-000000000002')
const DEPARTING = userId('user-inbox-release-grouping-departing')
const ADMIN = userId('user-inbox-release-grouping-admin')
const NOW = new Date('2026-09-20T12:00:00.000Z')

let pool: Pool
const db = getDb()

const store = () =>
  createAtomicInboxCommandStore(
    db,
    async () => ({ allowed: true }),
    () => NOW,
  )

let sequence = 0
const item = (property: string, status: 'open' | 'closed'): InboxItem => {
  sequence += 1
  const suffix = String(sequence).padStart(12, '0')
  return {
    id: inboxItemId(`4e000000-0000-4000-8001-${suffix}`),
    organizationId: ORG,
    propertyId: propertyId(property),
    sourceType: 'feedback',
    sourceId: feedbackId(`4e000000-0000-4000-8002-${suffix}`),
    status,
    rating: null,
    sourceDate: NOW,
    platform: null,
    snippet: null,
    assignedTo: DEPARTING,
    reviewerName: null,
    propertyName: null,
    isEscalated: false,
    escalatedAt: null,
    escalatedBy: null,
    escalationResolvedAt: null,
    escalationResolvedBy: null,
    closedAt: status === 'closed' ? NOW : null,
    firstReplySubmittedAt: null,
    firstReplyPublishedAt: null,
    commandRevision: 1,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

const seed = async (items: readonly InboxItem[]) => {
  for (const seeded of [...items].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    await store().createItem(seeded, null, {
      sourceRevision: 1,
      openedReason: 'legacy_backfill',
      actorType: 'system',
      triggerEventId: null,
      openedAt: NOW,
    })
  }
}

const groupedFacts = async () =>
  (
    await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM outbox_events
       WHERE organization_id = $1
         AND event_type = 'inbox.inbox_items.assignments_released'`,
      [ORG],
    )
  ).rows.map((row) => row.payload)

const clearScope = async () => {
  await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG])
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  clearEventSchemas()
  registerAllEventSchemas()
  await deleteTestOrganizations(pool, [ORG])
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Release Grouping Org', 'inbox-release-grouping', NOW())`,
    [ORG],
  )
  for (const [id, slug] of [
    [OPEN_PROPERTY, 'release-grouping-open'],
    [HANDLED_PROPERTY, 'release-grouping-handled'],
  ] as const) {
    await pool.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
       VALUES ($1, $2, $3, $3, 'UTC', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [id, ORG, slug],
    )
  }
})

beforeEach(clearScope)

afterAll(async () => {
  clearEventSchemas()
  await clearScope()
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await deleteTestOrganizations(pool, [ORG])
  await pool.end()
})

describe.sequential('the grouped fact of an assignment release (integration)', () => {
  it('counts only the open items that were left without an owner', async () => {
    const open = item(OPEN_PROPERTY, 'open')
    await seed([
      open,
      item(OPEN_PROPERTY, 'closed'),
      item(OPEN_PROPERTY, 'closed'),
      item(HANDLED_PROPERTY, 'closed'),
    ])

    const result = await store().releaseAssignmentsForUser({
      organizationId: ORG,
      userId: DEPARTING,
      actorId: ADMIN,
      at: NOW,
    })

    // Every assignment is still cleared, handled ones included.
    expect(result).toEqual({ released: 4 })
    expect(await groupedFacts()).toEqual([
      expect.objectContaining({
        count: 1,
        releases: [{ propertyId: OPEN_PROPERTY, anchorInboxItemId: open.id, count: 1 }],
      }),
    ])
  })

  it('records no grouped fact when every released item was already handled', async () => {
    await seed([item(HANDLED_PROPERTY, 'closed'), item(HANDLED_PROPERTY, 'closed')])

    const result = await store().releaseAssignmentsForUser({
      organizationId: ORG,
      userId: DEPARTING,
      actorId: ADMIN,
      at: NOW,
    })

    expect(result).toEqual({ released: 2 })
    expect(await groupedFacts()).toEqual([])
  })
})
