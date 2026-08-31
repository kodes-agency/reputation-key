import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'

describe('0128 Notification source-content database boundary', () => {
  let lease: TestLease

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
  })

  afterAll(async () => {
    await lease?.release()
  })

  it('removes provider ratings while translating legacy Portal ratings', async () => {
    const organization = `org-${randomUUID()}`
    const property = randomUUID()
    const providerNotification = randomUUID()
    const portalNotification = randomUUID()
    await lease.pool.query('BEGIN')
    try {
      await lease.pool.query(
        `INSERT INTO properties (id, organization_id, name, slug, timezone)
         VALUES ($1, $2, 'Notification boundary', $3, 'UTC')`,
        [property, organization, `notification-boundary-${property}`],
      )
      await lease.pool.query(
        `INSERT INTO notifications (
           id, user_id, organization_id, property_id, type, category, priority,
           status, resource_type, resource_id, event_id, title, body, payload
         ) VALUES
           ($1, 'manager-provider', $3, $4, 'review.created',
            'workflow_collaboration', 'normal', 'unread', 'inbox_item',
            'provider-item', 'provider-event', 'New 2-star review',
            'A low rating needs a reply soon. Open it to draft one.',
            '{"propertyName":"Riverside","platform":"google","rating":2}'::jsonb),
           ($2, 'manager-portal', $3, $4, 'feedback.created',
            'urgent_operational', 'urgent', 'unread', 'inbox_item',
            'portal-item', 'portal-event', 'New guest feedback',
            'Rated 4 out of 5. Open it to read the feedback.',
            '{"propertyName":"Riverside","platform":"portal","rating":4}'::jsonb)`,
        [providerNotification, portalNotification, organization, property],
      )

      const rows = await lease.pool.query<{
        id: string
        title: string
        body: string | null
        payload: Record<string, unknown>
      }>(
        `SELECT id, title, body, payload
           FROM notifications
          WHERE id = ANY($1::uuid[])
          ORDER BY id`,
        [[providerNotification, portalNotification]],
      )
      const byId = new Map(rows.rows.map((row) => [row.id, row]))
      expect(byId.get(providerNotification)).toMatchObject({
        title: 'New review',
        body: 'Open it to read the review and reply.',
        payload: {
          propertyName: 'Riverside',
          platform: 'google',
        },
      })
      expect(byId.get(providerNotification)?.payload).not.toHaveProperty('rating')
      expect(byId.get(providerNotification)?.payload).not.toHaveProperty('guestRating')
      expect(byId.get(portalNotification)).toMatchObject({
        payload: {
          propertyName: 'Riverside',
          platform: 'portal',
          guestRating: 4,
        },
      })
      expect(byId.get(portalNotification)?.payload).not.toHaveProperty('rating')

      const constraint = await lease.pool.query<{ convalidated: boolean }>(
        `SELECT convalidated
           FROM pg_constraint
          WHERE conname = 'notifications_source_content_free_check'`,
      )
      expect(constraint.rows).toEqual([{ convalidated: true }])
    } finally {
      await lease.pool.query('ROLLBACK')
    }
  })
})
