import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'

const LEGACY_FACT_ID = '86000000-0000-4000-8000-000000000001'
const CLEAN_FACT_ID = '86000000-0000-4000-8000-000000000002'
const REJECTED_FACT_ID = '86000000-0000-4000-8000-000000000003'

function insertFact(id: string, email?: string): unknown[] {
  return [
    id,
    JSON.stringify({
      invitationId: `invitation-${id.slice(-1)}`,
      organizationId: 'organization-1',
      role: 'PropertyManager',
      ...(email ? { email } : {}),
    }),
  ]
}

describe('identity invitation fact rolling contract', () => {
  let lease: TestLease

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
  })

  afterAll(async () => {
    await lease.release()
  })

  it('redacts legacy v1 writes, promotes clean writes to v2, and rejects a stale PII producer', async () => {
    const client = await lease.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `UPDATE identity_invitation_fact_contract
         SET issuance_version = 1, generation = generation + 1,
             switched_at = NULL, verified_at = NULL,
             operator_id = NULL, reason = NULL`,
      )
      await client.query(
        `INSERT INTO outbox_events (
           id, event_type, event_version, payload, organization_id,
           source_context, source_aggregate_id
         ) VALUES ($1, 'identity.member.invited', 1, $2::jsonb,
                   'organization-1', 'identity', 'invitation-1')`,
        insertFact(LEGACY_FACT_ID, 'synthetic-secret@example.test'),
      )

      const legacy = await client.query<{
        event_version: number
        payload: Record<string, unknown>
      }>(`SELECT event_version, payload FROM outbox_events WHERE id = $1`, [
        LEGACY_FACT_ID,
      ])
      expect(legacy.rows[0]).toMatchObject({
        event_version: 1,
        payload: { email: '[redacted]' },
      })
      expect(JSON.stringify(legacy.rows)).not.toContain('synthetic-secret@example.test')

      await client.query(
        `UPDATE identity_invitation_fact_contract
         SET issuance_version = 2, generation = generation + 1,
             switched_at = now(), operator_id = 'integration-test',
             reason = 'verify rolling contract', updated_at = now()`,
      )
      await client.query(
        `INSERT INTO outbox_events (
           id, event_type, event_version, payload, organization_id,
           source_context, source_aggregate_id
         ) VALUES ($1, 'identity.member.invited', 1, $2::jsonb,
                   'organization-1', 'identity', 'invitation-2')`,
        insertFact(CLEAN_FACT_ID),
      )
      const clean = await client.query<{
        event_version: number
        payload: Record<string, unknown>
      }>(`SELECT event_version, payload FROM outbox_events WHERE id = $1`, [
        CLEAN_FACT_ID,
      ])
      expect(clean.rows[0]!.event_version).toBe(2)
      expect(clean.rows[0]!.payload).not.toHaveProperty('email')

      await expect(
        client.query(
          `INSERT INTO outbox_events (
             id, event_type, event_version, payload, organization_id,
             source_context, source_aggregate_id
           ) VALUES ($1, 'identity.member.invited', 1, $2::jsonb,
                     'organization-1', 'identity', 'invitation-3')`,
          insertFact(REJECTED_FACT_ID, 'stale-producer@example.test'),
        ),
      ).rejects.toThrow(/legacy identity invitation fact producer/i)
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })

  it('holds the contract row lock until an in-flight fact insert commits', async () => {
    const writer = await lease.pool.connect()
    const switcher = await lease.pool.connect()
    try {
      await writer.query('BEGIN')
      await writer.query(
        `INSERT INTO outbox_events (
           id, event_type, event_version, payload, organization_id,
           source_context, source_aggregate_id
         ) VALUES (
           '86000000-0000-4000-8000-000000000004',
           'identity.member.invited', 1,
           '{"invitationId":"invitation-4","organizationId":"organization-1","role":"PropertyManager"}'::jsonb,
           'organization-1', 'identity', 'invitation-4'
         )`,
      )

      await switcher.query('BEGIN')
      await switcher.query(`SET LOCAL lock_timeout = '100ms'`)
      await expect(
        switcher.query(
          `UPDATE identity_invitation_fact_contract
           SET issuance_version = 2, switched_at = now(),
               operator_id = 'integration-test', reason = 'lock proof'`,
        ),
      ).rejects.toMatchObject({ code: '55P03' })
    } finally {
      await writer.query('ROLLBACK')
      await switcher.query('ROLLBACK')
      writer.release()
      switcher.release()
    }
  })
})
