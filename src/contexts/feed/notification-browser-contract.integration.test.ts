// What the browser receives from the Feed's notification reads (real
// PostgreSQL, real Feed build).
//
// The bell polls the head every 30 seconds per visible tab, so whatever a row
// carries sits in network logs, browser caches and error breadcrumbs. The
// in-app surfaces render from `type` + `payload` and act on ids, status and
// Property. The durable-delivery correlation id (withheld even from the
// Organization export), the frozen pre-template title/body snapshot and the
// ids the session already implies must stay on the server.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { OutboxRepository } from '#/shared/outbox'
import { organizationId, recentActivityEntryId, userId } from '#/shared/domain/ids'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { operationalActionHistoryRecordId } from './domain/operational-action-history'
import { buildFeedContext } from './build'

const ORG = 'org-notification-browser-contract'
const USER = 'user-notification-browser-contract'
const PROPERTY = '86300000-0000-4000-8000-000000000001'
const ROW = '86300000-0000-4000-8000-000000000011'
const EVENT_ID = 'event-correlation-86300000'
const FROZEN_TITLE = 'LEGACY SNAPSHOT TITLE 86300000'

const BROWSER_FIELDS = [
  'category',
  'coalescedCount',
  'coalescedLatestAt',
  'createdAt',
  'id',
  'payload',
  'priority',
  'propertyId',
  'readAt',
  'resolvedAt',
  'resourceId',
  'resourceType',
  'status',
  'type',
]

let pool: Pool

function feedPublicApi() {
  const clock = () => new Date('2026-09-22T09:00:00.000Z')
  const logger = createMockLogger()
  return buildFeedContext({
    activity: {
      db: getDb(),
      staffPublicApi: {} as StaffPublicApi,
      clock,
      logger,
      idGen: () => recentActivityEntryId('86300000-0000-4000-8000-000000000999'),
      operationalHistoryIdGen: () =>
        operationalActionHistoryRecordId('86300000-0000-4000-8000-000000000998'),
      operationalHistoryHoldIdGen: () => '86300000-0000-4000-8000-000000000997',
    },
    notification: {
      db: getDb(),
      outboxRepo: {} as OutboxRepository,
      queue: undefined,
      clock,
      idGen: () => '86300000-0000-4000-8000-000000000996',
      logger,
      responsibleManagers: {} as never,
      replyApproval: {} as never,
      feedbackPortalLookup: {} as never,
      googleConnectionProperties: {} as never,
      propertyImportInitiators: {} as never,
      monthlyResultFacts: {} as never,
      portalHealthLookup: {} as never,
      isEmailDeliveryAllowed: () => true,
      propertyAccess: async () => null,
      emailAddressKey: 'feed-test-email-address-key',
    },
  }).publicApi
}

const READER = {
  userId: userId(USER),
  organizationId: organizationId(ORG),
  role: 'AccountAdmin',
} as const

async function removeFixtures() {
  await pool.query('DELETE FROM notifications WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM properties WHERE id = $1', [PROPERTY])
  await deleteTestOrganizations(pool, [ORG])
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
})

afterAll(async () => {
  await removeFixtures()
  await pool.end()
})

beforeEach(async () => {
  await removeFixtures()
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Browser contract', 'notification-browser-contract', NOW())`,
    [ORG],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Contract property', 'notification-browser-contract-property', 'UTC', NOW(), NOW())`,
    [PROPERTY, ORG],
  )
  await pool.query(
    `INSERT INTO notifications (
       id, user_id, organization_id, property_id, type, category, priority, status,
       resource_type, resource_id, event_id, title, body, payload, read_at,
       created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, 'feedback.created', 'urgent_operational', 'normal', 'read',
       'inbox_item', $5, $6, $7, 'LEGACY SNAPSHOT BODY', '{"propertyName":"Contract property"}',
       '2026-09-21T09:00:00Z', '2026-09-21T08:00:00Z', '2026-09-21T09:00:00Z'
     )`,
    [ROW, USER, ORG, PROPERTY, `resource-${ROW}`, EVENT_ID, FROZEN_TITLE],
  )
})

describe.sequential('notification browser contract (real PostgreSQL)', () => {
  it('sends the polled head and history pages only what the feed renders', async () => {
    const api = feedPublicApi()

    const head = await api.getFeedHead(READER, { limit: 20, filter: 'all' })
    const page = await api.getNotifications(READER, {
      limit: 20,
      filter: 'all',
      before: null,
    })

    for (const row of [head.page.notifications[0], page.notifications[0]]) {
      expect(Object.keys(row ?? {}).sort()).toEqual(BROWSER_FIELDS)
    }
    expect(JSON.stringify([head, page])).not.toContain(EVENT_ID)
    expect(JSON.stringify([head, page])).not.toContain(FROZEN_TITLE)
  })

  it('answers mark-unread with the same browser shape', async () => {
    const flipped = await feedPublicApi().markUnread(ROW, ORG, userId(USER))

    expect(Object.keys(flipped ?? {}).sort()).toEqual(BROWSER_FIELDS)
    expect(flipped?.status).toBe('unread')
  })
})
