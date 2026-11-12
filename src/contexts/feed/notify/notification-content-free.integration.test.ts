import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'

const CHECK_VIOLATION = '23514'

describe('the notification payload database boundary', () => {
  let lease: TestLease

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
  })

  afterAll(async () => {
    await lease?.release()
  })

  const insertWithPayload = async (
    client: PoolClient,
    organization: string,
    property: string,
    payload: Record<string, unknown>,
  ): Promise<string> => {
    const id = randomUUID()
    await client.query(
      `INSERT INTO notifications (
         id, user_id, organization_id, property_id, type, category, priority,
         status, resource_type, resource_id, event_id, title, body, payload
       ) VALUES ($1, 'manager', $2, $3, 'review.created', 'workflow_collaboration',
                 'normal', 'unread', 'inbox_item', $4, $4, 'New review', '', $5::jsonb)`,
      [id, organization, property, randomUUID(), JSON.stringify(payload)],
    )
    return id
  }

  const withProperty = async (
    run: (client: PoolClient, organization: string, property: string) => Promise<void>,
  ) => {
    const organization = `org-${randomUUID()}`
    const property = randomUUID()
    const client = await lease.pool.connect()
    await client.query('BEGIN')
    try {
      await client.query(
        `INSERT INTO properties (id, organization_id, name, slug, timezone)
         VALUES ($1, $2, 'Content free', $3, 'UTC')`,
        [property, organization, `content-free-${property}`],
      )
      await run(client, organization, property)
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  }

  const storedPayload = async (
    client: PoolClient,
    id: string,
  ): Promise<Record<string, unknown>> => {
    const { rows } = await client.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM notifications WHERE id = $1`,
      [id],
    )
    return rows[0]?.payload ?? {}
  }

  const UNSOUND_PAYLOADS = [
    { propertyName: 'Riverside', platform: 'google', rating: 2 },
    { platform: 'portal', rating: 9 },
    { platform: 'google', guestRating: 3 },
    { guestRating: 3 },
    { platform: 'portal', guestRating: 6 },
    { platform: 'portal', guestRating: '4' },
  ]

  it('drops a provider rating or an unsound guest rating on the way in and keeps the rest', async () => {
    await withProperty(async (client, organization, property) => {
      for (const payload of UNSOUND_PAYLOADS) {
        const id = await insertWithPayload(client, organization, property, payload)
        const stored = await storedPayload(client, id)
        expect(stored).not.toHaveProperty('rating')
        expect(stored).not.toHaveProperty('guestRating')
      }
      const keptId = await insertWithPayload(client, organization, property, {
        propertyName: 'Riverside',
        platform: 'portal',
        guestRating: 4,
        occurrences: 2,
      })
      expect(await storedPayload(client, keptId)).toEqual({
        propertyName: 'Riverside',
        platform: 'portal',
        guestRating: 4,
        occurrences: 2,
      })
    })
  })

  it('refuses the same payloads outright when nothing normalises them first', async () => {
    await withProperty(async (client, organization, property) => {
      await client.query(
        'ALTER TABLE notifications DISABLE TRIGGER notifications_normalize_source_content',
      )
      for (const payload of UNSOUND_PAYLOADS) {
        await client.query('SAVEPOINT refused')
        await expect(
          insertWithPayload(client, organization, property, payload),
        ).rejects.toMatchObject({
          code: CHECK_VIOLATION,
          constraint: 'notifications_source_content_free_check',
        })
        await client.query('ROLLBACK TO SAVEPOINT refused')
      }
    })
  })
})
