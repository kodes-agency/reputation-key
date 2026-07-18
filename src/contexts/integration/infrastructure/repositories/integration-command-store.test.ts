// BQC-3.5 — integration command store integration tests (real Postgres).
//
// Crash-boundary proofs on the real google_connections / gbp_import_jobs
// tables:
//   1. A forced outbox failure (unregistered fact type) rolls back EVERYTHING
//      — no connection row, no status/redaction, no job status survives.
//   2. Happy path: the state row and the outbox_events row commit together
//      with the same eventId.
//   3. The global-uniqueness race contract (UniqueViolationError) holds.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import type { EventBus } from '#/shared/events/event-bus'
import {
  gbpImportJobId,
  googleConnectionId,
  organizationId,
  userId,
} from '#/shared/domain/ids'
import type { GoogleConnection } from '../../domain/types'
import {
  integrationGoogleAccountConnected,
  integrationGoogleAccountDisconnected,
  integrationGoogleConnectionVisibilityChanged,
  integrationPropertyImportCompleted,
} from '../../domain/events'
import { isIntegrationError } from '../../domain/errors'
import { isUniqueViolationError } from '../../application/ports/google-connection.repository'
import { createAtomicIntegrationCommandStore } from '../integration-command-store'

const ORG_ID = organizationId('org-intcmd-0000-0000-0000-000000000001')
const CONN_ID = googleConnectionId('6c000000-0000-0000-0000-000000000001')
const JOB_ID = gbpImportJobId('6b000000-0000-0000-0000-000000000001')
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
    googleAccountId: 'ga-intcmd-1',
    googleEmail: 'intcmd@test.com',
    encryptedAccessToken: 'enc-a',
    encryptedRefreshToken: 'enc-r',
    tokenExpiresAt: new Date('2026-06-01T13:00:00.000Z'),
    scopes: ['scope-a'],
    connectedBy: userId('user-intcmd-00000000000000000001'),
    visibility: 'private',
    status: 'active',
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
    googleEmail: 'intcmd@test.com',
    occurredAt: NOW,
  })

async function truncateAll(p: Pool) {
  await p.query('DELETE FROM google_connections WHERE organization_id = $1', [ORG_ID])
  await p.query('DELETE FROM gbp_import_jobs WHERE organization_id = $1', [ORG_ID])
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
      'SELECT id, status, google_email FROM google_connections WHERE organization_id = $1',
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
    // Identifier-only: provider email never enters the durable payload.
    expect(facts.rows[0].payload).not.toHaveProperty('googleEmail')
  })

  it('connectGoogleAccount rolls back the insert when the fact insert fails (unregistered type)', async () => {
    const store = createAtomicIntegrationCommandStore(db, silentEvents)
    const ghost = {
      ...connectedEvent(),
      _tag: 'integration.ghost',
    } as unknown as Parameters<typeof store.connectGoogleAccount>[0]['event']

    await expect(
      store.connectGoogleAccount({ connection: makeConnection(), event: ghost }),
    ).rejects.toThrow()

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
      encryptedAccessToken: 'enc-a2',
      encryptedRefreshToken: 'enc-r2',
      tokenExpiresAt: new Date('2026-06-01T14:00:00.000Z'),
      visibility: 'organization',
      event: connectedEvent(),
    })

    expect(updated.visibility).toBe('organization')
    const rows = await pool.query(
      'SELECT encrypted_access_token, visibility, status FROM google_connections WHERE id = $1',
      [CONN_ID],
    )
    expect(rows.rows[0]).toMatchObject({
      encrypted_access_token: 'enc-a2',
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
      'SELECT status, encrypted_access_token, google_email, google_account_id, scopes FROM google_connections WHERE id = $1',
      [CONN_ID],
    )
    expect(rows.rows[0]).toMatchObject({
      status: 'disconnected',
      encrypted_access_token: 'redacted',
      google_email: 'redacted',
      google_account_id: `redacted:${CONN_ID as string}`,
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
    ).rejects.toThrow()

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

  it('recordImportCompleted commits terminal status + fact in one transaction', async () => {
    const store = createAtomicIntegrationCommandStore(db, silentEvents)
    await pool.query(
      `INSERT INTO gbp_import_jobs (id, organization_id, initiated_by, status, total_count, created_at, updated_at)
       VALUES ($1, $2, $3, 'in_progress', 3, NOW(), NOW())`,
      [JOB_ID, ORG_ID, 'user-intcmd-00000000000000000001'],
    )
    const event = integrationPropertyImportCompleted({
      importJobId: JOB_ID,
      organizationId: ORG_ID,
      totalCount: 3,
      importedCount: 2,
      skippedCount: 1,
      failedCount: 0,
      occurredAt: NOW,
    })

    await store.recordImportCompleted({
      organizationId: ORG_ID,
      importJobId: JOB_ID,
      finalStatus: 'completed_with_skips',
      now: NOW,
      event,
    })

    const rows = await pool.query('SELECT status FROM gbp_import_jobs WHERE id = $1', [
      JOB_ID,
    ])
    expect(rows.rows[0].status).toBe('completed_with_skips')
    const facts = await pool.query(
      `SELECT id FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'integration.property_import.completed' AND id = $2`,
      [ORG_ID, event.eventId],
    )
    expect(facts.rows).toHaveLength(1)
  })
})
