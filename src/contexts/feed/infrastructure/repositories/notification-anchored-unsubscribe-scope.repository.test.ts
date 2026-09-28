// A notice mailed through a Property that is only its delivery anchor gives a
// one-click unsubscribe nothing to switch off (real PostgreSQL). Its scope
// would be the anchor's category, so a click on the Google reconnect email —
// alone, or as a line in a digest — silently stopped every urgent email for a
// Property the message never named.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  digestBatchIdempotencyKey,
  digestMemberSet,
  digestProviderRequest,
} from '../digest-batch-identity'
import { createNotificationEmailRepository } from './notification-email.repository'

const ORG = 'org-notification-anchored-scope'
const USER = 'user-notification-anchored-scope'
const PROPERTY = '89000000-0000-4000-8000-000000000001'
const RECONNECT_EMAIL = '89000000-0000-4000-9000-000000000011'
const GOAL_EMAIL = '89000000-0000-4000-9000-000000000012'
const BATCH = '89000000-0000-4000-8000-000000000021'
const NOW = new Date('2026-09-25T08:00:00.000Z')
const REQUEST = {
  to: 'admin@example.com',
  subject: 'Digest',
  html: '',
  text: '',
  headers: {},
}

let pool: Pool

async function queued(
  emailId: string,
  type: 'integration.reauthorization_required' | 'goal.completed',
  category: 'urgent_operational' | 'recognition',
  cadence: 'immediate' | 'daily',
) {
  const notification = emailId.replace('-9000-', '-8000-')
  await pool.query(
    `INSERT INTO notifications (
       id, user_id, organization_id, property_id, type, category, priority, status,
       resource_type, resource_id, event_id, title, created_at, updated_at
     ) VALUES ($1::uuid, $2, $3, $4, $5, $6, 'normal', 'unread', 'integration', $1::text,
       $1::text, 'T', $7, $7)`,
    [notification, USER, ORG, PROPERTY, type, category, NOW],
  )
  await pool.query(
    `INSERT INTO notification_email_queue (
       id, notification_id, user_id, organization_id, property_id, category, cadence,
       status, priority, idempotency_key, created_at, updated_at
     ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, 'pending', 'normal', $1::text, $8, $8)`,
    [emailId, notification, USER, ORG, PROPERTY, category, cadence, NOW],
  )
}

const scopes = async (targetId: string) =>
  (
    await pool.query<{ category: string }>(
      `SELECT category FROM notification_unsubscribe_scopes WHERE target_id = $1
        ORDER BY category`,
      [targetId],
    )
  ).rows.map((row) => row.category)

async function removeFixtures() {
  await pool.query('DELETE FROM notification_digest_batches WHERE organization_id = $1', [
    ORG,
  ])
  await pool.query('DELETE FROM notification_email_queue WHERE organization_id = $1', [
    ORG,
  ])
  await pool.query('DELETE FROM notifications WHERE organization_id = $1', [ORG])
  await pool.query(
    'DELETE FROM notification_unsubscribe_scopes WHERE organization_id = $1',
    [ORG],
  )
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
     VALUES ($1, 'Anchored scope', 'notification-anchored-scope', NOW())`,
    [ORG],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Alpha', 'notification-anchored-scope', 'UTC', NOW(), NOW())`,
    [PROPERTY, ORG],
  )
})

describe.sequential('unsubscribe scopes of an anchored notice (real PostgreSQL)', () => {
  it('records none for the reconnect email itself', async () => {
    await queued(
      RECONNECT_EMAIL,
      'integration.reauthorization_required',
      'urgent_operational',
      'immediate',
    )

    await createNotificationEmailRepository(getDb()).recordEmailUnsubscribeScope(
      RECONNECT_EMAIL,
      ORG,
      NOW,
    )

    expect(await scopes(RECONNECT_EMAIL)).toEqual([])
  })

  it('leaves the reconnect line out of a digest scope and keeps the rest', async () => {
    await queued(
      RECONNECT_EMAIL,
      'integration.reauthorization_required',
      'urgent_operational',
      'daily',
    )
    await queued(GOAL_EMAIL, 'goal.completed', 'recognition', 'daily')
    const memberIds = [RECONNECT_EMAIL, GOAL_EMAIL]
    const memberDigest = digestMemberSet(memberIds)

    await createNotificationEmailRepository(getDb()).prepareDigestBatch({
      id: BATCH,
      organizationId: ORG,
      userId: USER,
      localDate: '2026-09-25',
      memberIds,
      memberDigest,
      contentDigest: digestProviderRequest(REQUEST),
      providerIdempotencyKey: digestBatchIdempotencyKey({
        organizationId: ORG,
        userId: USER,
        localDate: '2026-09-25',
        batchId: BATCH,
        memberDigest,
      }),
      unsubscribeKeyVersion: 'v1',
      providerRequest: REQUEST,
      preparedAt: NOW,
    })

    expect(await scopes(BATCH)).toEqual(['recognition'])
  })
})
