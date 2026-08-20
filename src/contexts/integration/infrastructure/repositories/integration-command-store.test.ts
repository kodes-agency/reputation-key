// BQC-3.5 — integration command store integration tests (real Postgres).
//
// Crash-boundary proofs on the real google_connections table: forced outbox
// failure rolls back state, happy paths co-commit state and facts, and global
// identity uniqueness maps to the domain race error.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import type { EventBus } from '#/shared/events/event-bus'
import { googleConnectionId, organizationId, userId } from '#/shared/domain/ids'
import type { GoogleConnection } from '../../domain/types'
import {
  integrationGoogleAccountConnected,
  integrationGoogleAccountDisconnected,
  integrationGoogleConnectionVisibilityChanged,
} from '../../domain/events'
import { isIntegrationError } from '../../domain/errors'
import { isUniqueViolationError } from '../../application/ports/google-connection.repository'
import { createAtomicIntegrationCommandStore } from '../integration-command-store'

const ORG_ID = organizationId('org-intcmd-0000-0000-0000-000000000001')
const CONN_ID = googleConnectionId('6c000000-0000-0000-0000-000000000001')
const NOW = new Date('2026-06-01T12:00:00.000Z')

let pool: Pool
const db = getDb()

const silentEvents: EventBus = {
  on: () => {},
  emit: async () => {},
  clear: () => {},
}

function makeConnection(overrides: Partial<GoogleConnection> = {}): GoogleConnection {
  return {
    id: CONN_ID,
    organizationId: ORG_ID,
    googleSubject: 'subject-intcmd-1',
    encryptedAccessToken: 'enc-a',
    encryptedRefreshToken: 'enc-r',
    tokenExpiresAt: new Date('2026-06-01T13:00:00.000Z'),
    scopes: ['scope-a'],
    connectedBy: userId('user-intcmd-00000000000000000001'),
    visibility: 'private',
    status: 'active',
    credentialUseState: 'active',
    cleanupMaterialDeadlineAt: null,
    lifecycleVersion: 1,
    accessVersion: 1,
    credentialGeneration: 1,
    encryptionKeyId: 'v1',
    lastSuccessfulSyncAt: null,
    statusReason: null,
    statusChangedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

const connectedEvent = () =>
  integrationGoogleAccountConnected({
    connectionId: CONN_ID,
    organizationId: ORG_ID,
    connectedBy: userId('user-intcmd-00000000000000000001'),
    occurredAt: NOW,
  })

async function truncateAll(p: Pool) {
  await p.query('DELETE FROM google_connections WHERE organization_id = $1', [ORG_ID])
  await p.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG_ID])
}

beforeAll(async () => {
  const env = getEnv()
  pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 })
  const client = await pool.connect()
  client.release()
  clearEventSchemas()
  registerAllEventSchemas()
})

afterAll(async () => {
  clearEventSchemas()
  await truncateAll(pool)
  await pool.end()
})

beforeEach(async () => {
  await truncateAll(pool)
})

describe.sequential('integrationCommandStore (integration)', () => {
  it('connectGoogleAccount commits the connection + connected fact in one transaction', async () => {
    const store = createAtomicIntegrationCommandStore(db, silentEvents)
    const event = connectedEvent()

    await store.connectGoogleAccount({ connection: makeConnection(), event })

    const rows = await pool.query(
      'SELECT id, status FROM google_connections WHERE organization_id = $1',
      [ORG_ID],
    )
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0].status).toBe('active')
    const facts = await pool.query(
      `SELECT id, payload FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'integration.google_account.connected' AND id = $2`,
      [ORG_ID, event.eventId],
    )
    expect(facts.rows).toHaveLength(1)
    expect(Object.keys(facts.rows[0].payload as object).sort()).toEqual([
      'connectedBy',
      'connectionId',
      'correlationId',
      'organizationId',
    ])
  })

  it('connectGoogleAccount rolls back the insert when the fact insert fails (unregistered type)', async () => {
    const store = createAtomicIntegrationCommandStore(db, silentEvents)
    const ghost = {
      ...connectedEvent(),
      _tag: 'integration.ghost',
    } as unknown as Parameters<typeof store.connectGoogleAccount>[0]['event']

    await expect(
      store.connectGoogleAccount({ connection: makeConnection(), event: ghost }),
    ).rejects.toThrow(/Event type integration\.ghost:v1 is not registered for the outbox/)

    const rows = await pool.query(
      'SELECT id FROM google_connections WHERE organization_id = $1',
      [ORG_ID],
    )
    expect(rows.rows).toHaveLength(0)
  })

  it('connectGoogleAccount maps the global unique race to UniqueViolationError', async () => {
    const store = createAtomicIntegrationCommandStore(db, silentEvents)
    await store.connectGoogleAccount({
      connection: makeConnection(),
      event: connectedEvent(),
    })

    await expect(
      store.connectGoogleAccount({
        connection: makeConnection({
          id: googleConnectionId('6c000000-0000-0000-0000-000000000002'),
        }),
        event: connectedEvent(),
      }),
    ).rejects.toSatisfy((e: unknown) => isUniqueViolationError(e))
  })

  it('reconnectGoogleAccount commits token/visibility update + fact in one transaction', async () => {
    const store = createAtomicIntegrationCommandStore(db, silentEvents)
    await store.connectGoogleAccount({
      connection: makeConnection(),
      event: connectedEvent(),
    })

    const updated = await store.reconnectGoogleAccount({
      organizationId: ORG_ID,
      connectionId: CONN_ID,
      googleSubject: 'google-subject-2',
      scopes: ['openid', 'https://www.googleapis.com/auth/business.manage'],
      encryptedAccessToken: 'enc-a2',
      encryptedRefreshToken: 'enc-r2',
      tokenExpiresAt: new Date('2026-06-01T14:00:00.000Z'),
      visibility: 'organization',
      event: connectedEvent(),
    })

    expect(updated).toMatchObject({
      googleSubject: 'google-subject-2',
      scopes: ['openid', 'https://www.googleapis.com/auth/business.manage'],
      visibility: 'organization',
    })
    const rows = await pool.query(
      'SELECT google_subject, encrypted_access_token, scopes, visibility, status FROM google_connections WHERE id = $1',
      [CONN_ID],
    )
    expect(rows.rows[0]).toMatchObject({
      google_subject: 'google-subject-2',
      encrypted_access_token: 'enc-a2',
      scopes: ['openid', 'https://www.googleapis.com/auth/business.manage'],
      visibility: 'organization',
      status: 'active',
    })
    const facts = await pool.query(
      `SELECT COUNT(*)::int AS n FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'integration.google_account.connected'`,
      [ORG_ID],
    )
    expect(facts.rows[0].n).toBe(2)
  })

  it('disconnectGoogleAccount commits status + redaction + fact in one transaction', async () => {
    const store = createAtomicIntegrationCommandStore(db, silentEvents)
    await store.connectGoogleAccount({
      connection: makeConnection(),
      event: connectedEvent(),
    })
    const event = integrationGoogleAccountDisconnected({
      connectionId: CONN_ID,
      organizationId: ORG_ID,
      occurredAt: NOW,
    })

    const result = await store.disconnectGoogleAccount({
      organizationId: ORG_ID,
      connectionId: CONN_ID,
      event,
    })

    expect(result.status).toBe('disconnected')
    const rows = await pool.query(
      'SELECT status, encrypted_access_token, google_subject, scopes FROM google_connections WHERE id = $1',
      [CONN_ID],
    )
    expect(rows.rows[0]).toMatchObject({
      status: 'disconnected',
      encrypted_access_token: 'redacted',
      google_subject: null,
      scopes: [],
    })
    const facts = await pool.query(
      `SELECT id FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'integration.google_account.disconnected' AND id = $2`,
      [ORG_ID, event.eventId],
    )
    expect(facts.rows).toHaveLength(1)
  })

  it('disconnectGoogleAccount rolls back status + redaction when the fact insert fails', async () => {
    const store = createAtomicIntegrationCommandStore(db, silentEvents)
    await store.connectGoogleAccount({
      connection: makeConnection(),
      event: connectedEvent(),
    })
    const ghost = {
      ...integrationGoogleAccountDisconnected({
        connectionId: CONN_ID,
        organizationId: ORG_ID,
        occurredAt: NOW,
      }),
      _tag: 'integration.ghost',
    } as unknown as Parameters<typeof store.disconnectGoogleAccount>[0]['event']

    await expect(
      store.disconnectGoogleAccount({
        organizationId: ORG_ID,
        connectionId: CONN_ID,
        event: ghost,
      }),
    ).rejects.toThrow(/Event type integration\.ghost:v1 is not registered for the outbox/)

    // The pre-BQC-3.5 crash window is closed: no status flip, no redaction.
    const rows = await pool.query(
      'SELECT status, encrypted_access_token FROM google_connections WHERE id = $1',
      [CONN_ID],
    )
    expect(rows.rows[0]).toMatchObject({
      status: 'active',
      encrypted_access_token: 'enc-a',
    })
  })

  it('disconnectGoogleAccount throws connection_not_found for a missing row — no fact', async () => {
    const store = createAtomicIntegrationCommandStore(db, silentEvents)

    await expect(
      store.disconnectGoogleAccount({
        organizationId: ORG_ID,
        connectionId: CONN_ID,
        event: integrationGoogleAccountDisconnected({
          connectionId: CONN_ID,
          organizationId: ORG_ID,
          occurredAt: NOW,
        }),
      }),
    ).rejects.toSatisfy(
      (e: unknown) => isIntegrationError(e) && e.code === 'connection_not_found',
    )

    const facts = await pool.query(
      'SELECT id FROM outbox_events WHERE organization_id = $1',
      [ORG_ID],
    )
    expect(facts.rows).toHaveLength(0)
  })

  it('updateConnectionVisibility commits the update + fact in one transaction', async () => {
    const store = createAtomicIntegrationCommandStore(db, silentEvents)
    await store.connectGoogleAccount({
      connection: makeConnection(),
      event: connectedEvent(),
    })

    const updated = await store.updateConnectionVisibility({
      organizationId: ORG_ID,
      connectionId: CONN_ID,
      visibility: 'organization',
      event: integrationGoogleConnectionVisibilityChanged({
        connectionId: CONN_ID,
        organizationId: ORG_ID,
        visibility: 'organization',
        occurredAt: NOW,
      }),
    })

    expect(updated.visibility).toBe('organization')
    const facts = await pool.query(
      `SELECT id FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'integration.google_connection.visibility_changed'`,
      [ORG_ID],
    )
    expect(facts.rows).toHaveLength(1)
  })
})
