import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import { googleConnectionId, organizationId, userId } from '#/shared/domain/ids'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createGoogleConnectorDepartureStore } from './google-connector-departure.store'

const ORGANIZATION_ID = organizationId('org-google-connector-departure-store')
const CONNECTOR_USER_ID = userId('user-google-connector-departure-store')
const REAUTHORIZER_USER_ID = userId('user-google-connector-reauthorizer-store')
const CONNECTION_A = googleConnectionId('81000000-0000-4000-8000-000000000001')
const CONNECTION_B = googleConnectionId('81000000-0000-4000-8000-000000000002')
const CONNECTION_REAUTHORIZED = googleConnectionId('81000000-0000-4000-8000-000000000003')
const NOW = new Date('2026-08-27T01:00:00.000Z')

describe('PostgreSQL Google connector departure store', () => {
  let lease: TestLease

  beforeAll(async () => {
    registerAllEventSchemas()
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    await lease.pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [
      ORGANIZATION_ID,
    ])
    await lease.pool.query('DELETE FROM google_connections WHERE organization_id = $1', [
      ORGANIZATION_ID,
    ])
    await lease.pool.query(
      `INSERT INTO google_connections (
         id, organization_id, google_subject, encrypted_access_token,
         encrypted_refresh_token, token_expires_at, scopes, connected_by,
         credential_authorized_by, credential_authorized_at, visibility,
         status, credential_use_state, lifecycle_version, access_version,
         credential_generation
       ) VALUES
         ($1, $4, $7, 'access-a', 'refresh-a', now() + interval '1 hour',
          ARRAY['scope']::text[], $5, $5, now(), 'organization', 'active',
          'active', 7, 11, 3),
         ($2, $4, $8, 'access-b', 'refresh-b', now() + interval '1 hour',
          ARRAY['scope']::text[], $5, $5, now(), 'organization', 'degraded',
          'active', 13, 17, 5),
         ($3, $4, $9, 'access-c', 'refresh-c', now() + interval '1 hour',
          ARRAY['scope']::text[], $5, $6, now(), 'organization', 'active',
          'active', 19, 23, 7)`,
      [
        CONNECTION_A,
        CONNECTION_B,
        CONNECTION_REAUTHORIZED,
        ORGANIZATION_ID,
        CONNECTOR_USER_ID,
        REAUTHORIZER_USER_ID,
        `subject-${CONNECTION_A}`,
        `subject-${CONNECTION_B}`,
        `subject-${CONNECTION_REAUTHORIZED}`,
      ],
    )
  })

  afterAll(async () => {
    await lease?.pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [
      ORGANIZATION_ID,
    ])
    await lease?.pool.query('DELETE FROM google_connections WHERE organization_id = $1', [
      ORGANIZATION_ID,
    ])
    await lease?.release()
  })

  it('fences every current grant once, preserves first-connection provenance, and retries idempotently', async () => {
    const store = createGoogleConnectorDepartureStore(getDb())
    const first = await store.fenceForDeparture({
      organizationId: ORGANIZATION_ID,
      connectorUserId: CONNECTOR_USER_ID,
      cause: 'member_removed',
      occurredAt: NOW,
    })

    expect(first).toEqual({
      connectionIds: [CONNECTION_A, CONNECTION_B],
      transitionedConnectionIds: [CONNECTION_A, CONNECTION_B],
    })
    const rows = await lease.pool.query<{
      id: string
      connected_by: string
      credential_authorized_by: string | null
      status: string
      lifecycle_version: number
      access_version: number
      status_reason: string | null
    }>(
      `SELECT id, connected_by, credential_authorized_by, status,
              lifecycle_version, access_version, status_reason
         FROM google_connections
        WHERE organization_id = $1
        ORDER BY id`,
      [ORGANIZATION_ID],
    )
    expect(rows.rows).toEqual([
      {
        id: CONNECTION_A,
        connected_by: CONNECTOR_USER_ID,
        credential_authorized_by: CONNECTOR_USER_ID,
        status: 'reauth_required',
        lifecycle_version: 8,
        access_version: 12,
        status_reason: 'connector_departure_member_removed',
      },
      {
        id: CONNECTION_B,
        connected_by: CONNECTOR_USER_ID,
        credential_authorized_by: CONNECTOR_USER_ID,
        status: 'reauth_required',
        lifecycle_version: 14,
        access_version: 18,
        status_reason: 'connector_departure_member_removed',
      },
      {
        id: CONNECTION_REAUTHORIZED,
        connected_by: CONNECTOR_USER_ID,
        credential_authorized_by: REAUTHORIZER_USER_ID,
        status: 'active',
        lifecycle_version: 19,
        access_version: 23,
        status_reason: null,
      },
    ])
    const facts = await lease.pool.query<{ aggregate_id: string }>(
      `SELECT source_aggregate_id AS aggregate_id
         FROM outbox_events
        WHERE organization_id = $1
          AND event_type = 'integration.google_account.reauthorization_required'
        ORDER BY source_aggregate_id`,
      [ORGANIZATION_ID],
    )
    expect(facts.rows.map((row) => row.aggregate_id)).toEqual([
      CONNECTION_A,
      CONNECTION_B,
    ])

    await expect(
      store.fenceForDeparture({
        organizationId: ORGANIZATION_ID,
        connectorUserId: CONNECTOR_USER_ID,
        cause: 'member_removed',
        occurredAt: new Date(NOW.getTime() + 1_000),
      }),
    ).resolves.toEqual({
      connectionIds: [CONNECTION_A, CONNECTION_B],
      transitionedConnectionIds: [],
    })
    const factCount = await lease.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM outbox_events
        WHERE organization_id = $1
          AND event_type = 'integration.google_account.reauthorization_required'`,
      [ORGANIZATION_ID],
    )
    expect(factCount.rows[0]?.count).toBe('2')
  })
})
