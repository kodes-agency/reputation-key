import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { createNotificationRepository } from './notification.repository'

const ORG_A = 'org-notification-list-a'
const ORG_B = 'org-notification-list-b'
const PROPERTY_A = '81000000-0000-4000-8000-000000000001'
const PROPERTY_B = '81000000-0000-4000-8000-000000000002'
const USER = 'user-notification-list'

let pool: Pool

async function insertNotification(input: {
  id: string
  organizationId?: string
  propertyId?: string
  type?: string
  category?: string
  priority?: string
  status?: string
  createdAt: string
}) {
  await pool.query(
    `INSERT INTO notifications (
       id, user_id, organization_id, property_id, type, category, priority,
       status, resource_type, resource_id, event_id, title, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'inbox_item', $9, $10, 'Test', $11, $11)`,
    [
      input.id,
      USER,
      input.organizationId ?? ORG_A,
      input.propertyId ?? PROPERTY_A,
      input.type ?? 'review.created',
      input.category ?? 'urgent_operational',
      input.priority ?? 'normal',
      input.status ?? 'read',
      `resource-${input.id}`,
      `event-${input.id}`,
      input.createdAt,
    ],
  )
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
})

afterAll(async () => {
  await pool.query('DELETE FROM notifications WHERE organization_id IN ($1, $2)', [
    ORG_A,
    ORG_B,
  ])
  await pool.query('DELETE FROM properties WHERE id IN ($1, $2)', [
    PROPERTY_A,
    PROPERTY_B,
  ])
  await pool.query('DELETE FROM organization WHERE id IN ($1, $2)', [ORG_A, ORG_B])
  await pool.end()
})

beforeEach(async () => {
  await pool.query('DELETE FROM notifications WHERE organization_id IN ($1, $2)', [
    ORG_A,
    ORG_B,
  ])
  await pool.query('DELETE FROM properties WHERE id IN ($1, $2)', [
    PROPERTY_A,
    PROPERTY_B,
  ])
  await pool.query('DELETE FROM organization WHERE id IN ($1, $2)', [ORG_A, ORG_B])
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES
       ($1, 'Notification A', 'notification-list-a', NOW()),
       ($2, 'Notification B', 'notification-list-b', NOW())`,
    [ORG_A, ORG_B],
  )
  await pool.query(
    `INSERT INTO properties (
       id, organization_id, name, slug, timezone, created_at, updated_at
     ) VALUES
       ($1, $2, 'Property A', 'notification-property-a', 'UTC', NOW(), NOW()),
       ($3, $4, 'Property B', 'notification-property-b', 'UTC', NOW(), NOW())`,
    [PROPERTY_A, ORG_A, PROPERTY_B, ORG_B],
  )

  await insertNotification({
    id: '82000000-0000-4000-8000-000000000001',
    status: 'unread',
    createdAt: '2026-08-25T10:05:00Z',
  })
  await insertNotification({
    id: '82000000-0000-4000-8000-000000000002',
    createdAt: '2026-08-25T10:04:00Z',
  })
  await insertNotification({
    id: '82000000-0000-4000-8000-000000000003',
    priority: 'urgent',
    createdAt: '2026-08-25T10:03:00Z',
  })
  await insertNotification({
    id: '82000000-0000-4000-8000-000000000004',
    type: 'inbox_note.added',
    category: 'workflow_collaboration',
    priority: 'urgent',
    createdAt: '2026-08-25T10:02:00Z',
  })
  await insertNotification({
    id: '82000000-0000-4000-8000-000000000005',
    priority: 'urgent',
    status: 'dismissed',
    createdAt: '2026-08-25T10:01:00Z',
  })
  await insertNotification({
    id: '82000000-0000-4000-8000-000000000006',
    organizationId: ORG_B,
    propertyId: PROPERTY_B,
    priority: 'urgent',
    createdAt: '2026-08-25T10:06:00Z',
  })
})

describe.sequential('notification list filters (real PostgreSQL)', () => {
  it('applies priority before pagination and excludes dismissed/foreign rows', async () => {
    const rows = await createNotificationRepository(getDb()).findByUser(
      USER,
      ORG_A,
      2,
      0,
      'urgent',
    )

    expect(rows.map((row) => row.id)).toEqual([
      '82000000-0000-4000-8000-000000000003',
      '82000000-0000-4000-8000-000000000004',
    ])
  })

  it('applies unread and category filters in the tenant query', async () => {
    const repo = createNotificationRepository(getDb())

    const unread = await repo.findByUser(USER, ORG_A, 10, 0, 'unread')
    const workflow = await repo.findByUser(USER, ORG_A, 10, 0, 'workflow_collaboration')

    expect(unread.map((row) => row.id)).toEqual(['82000000-0000-4000-8000-000000000001'])
    expect(workflow.map((row) => row.id)).toEqual([
      '82000000-0000-4000-8000-000000000004',
    ])
  })
})
