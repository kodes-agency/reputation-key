// Arrivals stay out of the feed until the reader turns them on in the app
// (real PostgreSQL; D4, ADR 0046 amended 2026-09-30).
//
// Migration 0041 kept everyone's review email: a reader with Workflow email on
// has arrivals email on. Each new review then writes an email-only anchor —
// stored read, never shown — and the feed's in-app check fell back to "on
// for every category" when the reader had no in-app row, so every one of them
// was listed under Updates and All: the arrivals D4 turned off, back in the
// bell. The fallback is now the versioned default, which is off for arrivals.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { organizationId, userId } from '#/shared/domain/ids'
import { createNotificationRepository } from './notification.repository'

const ORG = 'org-notification-arrivals-feed'
const USER = 'user-notification-arrivals-feed'
const PROPERTY = '86800000-0000-4000-8000-000000000001'

const ARRIVAL_ANCHOR = '86800000-0000-4000-8000-000000000011'
const WORKFLOW_ROW = '86800000-0000-4000-8000-000000000012'

const QUERY = {
  userId: userId(USER),
  organizationId: organizationId(ORG),
  visiblePropertyIds: null,
  filter: 'all' as const,
  limit: 10,
}

let pool: Pool

async function insertNotification(
  id: string,
  type: string,
  category: string,
  status: 'read' | 'unread',
  minute: number,
) {
  await pool.query(
    `INSERT INTO notifications (
       id, user_id, organization_id, property_id, type, category, priority, status,
       resource_type, resource_id, event_id, title, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, 'normal', $7, 'inbox_item', $8, $9, 'Test', $10, $10)`,
    [
      id,
      USER,
      ORG,
      PROPERTY,
      type,
      category,
      status,
      `resource-${id}`,
      `event-${id}`,
      `2026-09-30T08:${String(minute).padStart(2, '0')}:00Z`,
    ],
  )
}

async function setDefault(
  category: string,
  channel: 'in_app' | 'email',
  enabled: boolean,
) {
  await pool.query(
    `INSERT INTO notification_category_defaults (
       id, user_id, organization_id, category, channel, enabled, cadence,
       created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, 'daily', NOW(), NOW())`,
    [randomUUID(), USER, ORG, category, channel, enabled],
  )
}

async function cleanUp() {
  await pool.query('DELETE FROM notifications WHERE organization_id = $1', [ORG])
  await pool.query(
    'DELETE FROM notification_category_defaults WHERE organization_id = $1',
    [ORG],
  )
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await deleteTestOrganizations(pool, [ORG])
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
})

afterAll(async () => {
  await cleanUp()
  await pool.end()
})

beforeEach(async () => {
  await cleanUp()
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Arrivals feed', 'notification-arrivals-feed', NOW())`,
    [ORG],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Harbour', 'notification-arrivals-feed-harbour', 'UTC', NOW(), NOW())`,
    [PROPERTY, ORG],
  )
  // What migration 0041 leaves a reader who had Workflow email on.
  await setDefault('arrivals', 'email', true)
  await insertNotification(ARRIVAL_ANCHOR, 'review.created', 'arrivals', 'read', 2)
  await insertNotification(
    WORKFLOW_ROW,
    'inbox_note.added',
    'workflow_collaboration',
    'unread',
    1,
  )
})

describe.sequential('arrivals follow the in-app default (real PostgreSQL)', () => {
  it('leaves an email-only arrival out of the feed for a reader who never turned arrivals on in the app', async () => {
    const head = await createNotificationRepository(getDb()).readFeedHead(QUERY)

    expect(head.page.notifications.map((row) => row.id)).toEqual([WORKFLOW_ROW])
  })

  it('lists arrivals once the reader turns them on in the app', async () => {
    await setDefault('arrivals', 'in_app', true)

    const head = await createNotificationRepository(getDb()).readFeedHead(QUERY)

    expect(head.page.notifications.map((row) => row.id)).toEqual([
      ARRIVAL_ANCHOR,
      WORKFLOW_ROW,
    ])
  })
})
