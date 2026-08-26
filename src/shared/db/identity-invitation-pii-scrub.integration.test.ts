import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'

const migrationPath = resolve(
  process.cwd(),
  'drizzle/0105_identity_invitation_pii_scrub.sql',
)

describe('identity invitation PII scrub migration', () => {
  let lease: TestLease

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
  })

  afterAll(async () => {
    await lease.release()
  })

  it('removes invitee email from historical facts and activity detail', async () => {
    const client = await lease.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO outbox_events (
           id, event_type, event_version, payload, organization_id,
           source_context, source_aggregate_id
         ) VALUES (
           '86000000-0000-4000-8000-000000000001',
           'identity.member.invited', 1,
           '{"invitationId":"invitation-1","email":"invitee@example.test","role":"PropertyManager"}'::jsonb,
           'organization-1', 'identity', 'invitation-1'
         )`,
      )
      await client.query(
        `INSERT INTO activity_log (
           id, actor_id, actor_name, actor_role, action, resource_type,
           resource_id, organization_id, payload, source
         ) VALUES (
           '86000000-0000-4000-8000-000000000002',
           'actor-1', 'Account Admin', 'AccountAdmin', 'invited', 'member',
           'invitation-1', 'organization-1',
           '{"subject":"member","from":null,"to":"PropertyManager","detail":"invitee@example.test"}'::jsonb,
           'web'
         )`,
      )

      await client.query(readFileSync(migrationPath, 'utf8'))

      const fact = await client.query<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM outbox_events
         WHERE id = '86000000-0000-4000-8000-000000000001'`,
      )
      const activity = await client.query<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM activity_log
         WHERE id = '86000000-0000-4000-8000-000000000002'`,
      )

      expect(fact.rows[0]!.payload).not.toHaveProperty('email')
      expect(activity.rows[0]!.payload).toMatchObject({ detail: null })
      expect(JSON.stringify([fact.rows, activity.rows])).not.toContain(
        'invitee@example.test',
      )
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })
})
