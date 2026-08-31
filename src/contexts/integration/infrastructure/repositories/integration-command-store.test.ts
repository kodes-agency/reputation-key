// BQC-3.5 — integration command store integration tests (real Postgres).
//
// Crash-boundary proofs on the real google_connections table: forced outbox
// failure rolls back state, happy paths co-commit state and facts, and global
// identity uniqueness maps to the domain race error.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import type { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import type { EventBus } from '#/shared/events/event-bus'
import { DATA_CELL_CATALOGUE_POLICY_VERSION } from '#/shared/domain/data-cell-catalogue'
import { googleConnectionId, organizationId, userId } from '#/shared/domain/ids'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import type { GoogleConnection } from '../../domain/types'
import {
  integrationGoogleAccountConnected,
  integrationGoogleAccountDisconnected,
  integrationGoogleConnectionVisibilityChanged,
} from '../../domain/events'
import { isIntegrationError } from '../../domain/errors'
import { isUniqueViolationError } from '../../application/ports/google-connection.repository'
import { createAtomicIntegrationCommandStore } from '../integration-command-store'
import { createGoogleOAuthExchangeRecoveryRepository } from './google-oauth-exchange-recovery.repository'

const ORG_ID = organizationId('org-intcmd-0000-0000-0000-000000000001')
const CONN_ID = googleConnectionId('6c000000-0000-0000-0000-000000000001')
const INITIATOR_ID = userId('user-intcmd-00000000000000000001')
const EXCHANGE_ATTEMPT_ID = '6e000000-0000-4000-8000-000000000001'
const NOW = new Date('2026-06-01T12:00:00.000Z')
const HOME_BINDING = Object.freeze({
  homeCellId: 'us' as const,
  cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
  authorityGeneration: 1,
})

let pool: Pool
let lease: TestLease
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
    connectedBy: INITIATOR_ID,
    visibility: 'organization',
    status: 'active',
    credentialUseState: 'active',
    cleanupMaterialDeadlineAt: null,
    lifecycleVersion: 1,
    accessVersion: 1,
    credentialGeneration: 1,
    credentialHomeCellId: HOME_BINDING.homeCellId,
    credentialHomePolicyVersion: HOME_BINDING.cataloguePolicyVersion,
    credentialHomeAuthorityGeneration: HOME_BINDING.authorityGeneration,
    encryptionKeyId: 'v1',
    lastSuccessfulSyncAt: null,
    statusReason: null,
    statusChangedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
    credentialAuthorizedBy: overrides.credentialAuthorizedBy ?? INITIATOR_ID,
  }
}

const connectedEvent = () =>
  integrationGoogleAccountConnected({
    connectionId: CONN_ID,
    organizationId: ORG_ID,
    userId: INITIATOR_ID,
    occurredAt: NOW,
  })

async function truncateAll(p: Pool) {
  await p.query('DELETE FROM google_oauth_exchange_attempts WHERE organization_id = $1', [
    ORG_ID,
  ])
  await p.query('DELETE FROM google_connections WHERE organization_id = $1', [ORG_ID])
  await p.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG_ID])
  await p.query(
    'DELETE FROM google_organization_credential_homes WHERE organization_id = $1',
    [ORG_ID],
  )
}

async function prepareExchangeAttempt(id = EXCHANGE_ATTEMPT_ID) {
  const recovery = createGoogleOAuthExchangeRecoveryRepository(db)
  const facts = {
    id,
    organizationId: ORG_ID,
    initiatorUserId: INITIATOR_ID,
    connectionId: CONN_ID,
    connectionMode: 'new' as const,
    targetConnectionId: null,
    expectedLifecycleVersion: 0,
    expectedAccessVersion: 0,
    expectedCredentialGeneration: 0,
    credentialHome: HOME_BINDING,
  }
  await recovery.begin({ ...facts, now: NOW })
  await recovery.markProviderStarted({
    id,
    organizationId: ORG_ID,
    initiatorUserId: INITIATOR_ID,
    now: NOW,
  })
  await recovery.preserveSuccessfulResult({
    id,
    organizationId: ORG_ID,
    initiatorUserId: INITIATOR_ID,
    encryptedResult: 'application-encrypted-provider-response',
    now: NOW,
  })
  await recovery.claimPreservedResult({
    id,
    organizationId: ORG_ID,
    initiatorUserId: INITIATOR_ID,
    now: NOW,
  })
  return recovery
}

beforeAll(async () => {
  const env = getEnv()
  lease = await acquireTestLease(env.DATABASE_URL, 2)
  pool = lease.pool
  clearEventSchemas()
  registerAllEventSchemas()
})

afterAll(async () => {
  clearEventSchemas()
  await truncateAll(pool)
  await lease.release()
})

beforeEach(async () => {
  await truncateAll(pool)
})

describe.sequential('integrationCommandStore (integration)', () => {
  it('connectGoogleAccount commits the connection + connected fact in one transaction', async () => {
    const store = createAtomicIntegrationCommandStore(db, silentEvents, () => NOW)
    const event = connectedEvent()

    await store.connectGoogleAccount({
      connection: makeConnection(),
      credentialHomeBinding: HOME_BINDING,
      event,
    })

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
      'connectionId',
      'correlationId',
      'organizationId',
      'userId',
    ])
  })

  it('atomically commits a connection and erases its one-use exchange result', async () => {
    const recovery = await prepareExchangeAttempt()
    const store = createAtomicIntegrationCommandStore(db, silentEvents, () => NOW)

    await store.connectGoogleAccount({
      connection: makeConnection(),
      credentialHomeBinding: HOME_BINDING,
      exchangeAttemptId: EXCHANGE_ATTEMPT_ID,
      event: connectedEvent(),
    })

    const attempt = await pool.query(
      `SELECT state, encrypted_result, response_expires_at, apply_lease_expires_at,
              outcome_code
       FROM google_oauth_exchange_attempts WHERE id = $1`,
      [EXCHANGE_ATTEMPT_ID],
    )
    expect(attempt.rows[0]).toMatchObject({
      state: 'completed',
      encrypted_result: null,
      response_expires_at: null,
      apply_lease_expires_at: null,
      outcome_code: 'connection_committed',
    })
    await expect(
      recovery.loadCompletedAttempt({
        id: EXCHANGE_ATTEMPT_ID,
        organizationId: ORG_ID,
        initiatorUserId: INITIATOR_ID,
      }),
    ).resolves.toMatchObject({ connectionId: CONN_ID })
  })

  it('rolls back both connection and exchange completion when the fact cannot commit', async () => {
    await prepareExchangeAttempt()
    const store = createAtomicIntegrationCommandStore(db, silentEvents, () => NOW)
    const ghost = {
      ...connectedEvent(),
      _tag: 'integration.ghost',
    } as unknown as Parameters<typeof store.connectGoogleAccount>[0]['event']

    await expect(
      store.connectGoogleAccount({
        connection: makeConnection(),
        credentialHomeBinding: HOME_BINDING,
        exchangeAttemptId: EXCHANGE_ATTEMPT_ID,
        event: ghost,
      }),
    ).rejects.toThrow(/Event type integration\.ghost:v1 is not registered for the outbox/)

    const connections = await pool.query(
      'SELECT id FROM google_connections WHERE organization_id = $1',
      [ORG_ID],
    )
    const attempt = await pool.query(
      `SELECT state, encrypted_result
       FROM google_oauth_exchange_attempts WHERE id = $1`,
      [EXCHANGE_ATTEMPT_ID],
    )
    expect(connections.rows).toHaveLength(0)
    expect(attempt.rows[0]).toMatchObject({
      state: 'applying',
      encrypted_result: 'application-encrypted-provider-response',
    })
  })

  it('connectGoogleAccount rolls back the insert when the fact insert fails (unregistered type)', async () => {
    const store = createAtomicIntegrationCommandStore(db, silentEvents, () => NOW)
    const ghost = {
      ...connectedEvent(),
      _tag: 'integration.ghost',
    } as unknown as Parameters<typeof store.connectGoogleAccount>[0]['event']

    await expect(
      store.connectGoogleAccount({
        connection: makeConnection(),
        credentialHomeBinding: HOME_BINDING,
        event: ghost,
      }),
    ).rejects.toThrow(/Event type integration\.ghost:v1 is not registered for the outbox/)

    const rows = await pool.query(
      'SELECT id FROM google_connections WHERE organization_id = $1',
      [ORG_ID],
    )
    expect(rows.rows).toHaveLength(0)
  })

  it('connectGoogleAccount maps the global unique race to UniqueViolationError', async () => {
    const store = createAtomicIntegrationCommandStore(db, silentEvents, () => NOW)
    await store.connectGoogleAccount({
      connection: makeConnection(),
      credentialHomeBinding: HOME_BINDING,
      event: connectedEvent(),
    })

    await expect(
      store.connectGoogleAccount({
        connection: makeConnection({
          id: googleConnectionId('6c000000-0000-0000-0000-000000000002'),
        }),
        credentialHomeBinding: HOME_BINDING,
        event: connectedEvent(),
      }),
    ).rejects.toSatisfy((e: unknown) => isUniqueViolationError(e))
  })

  it('reconnectGoogleAccount commits token/visibility update + fact in one transaction', async () => {
    const store = createAtomicIntegrationCommandStore(db, silentEvents, () => NOW)
    await store.connectGoogleAccount({
      connection: makeConnection(),
      credentialHomeBinding: HOME_BINDING,
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
      credentialHome: HOME_BINDING,
      credentialHomeReason: 'credential_rotation',
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
    const store = createAtomicIntegrationCommandStore(db, silentEvents, () => NOW)
    await store.connectGoogleAccount({
      connection: makeConnection(),
      credentialHomeBinding: HOME_BINDING,
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
    const store = createAtomicIntegrationCommandStore(db, silentEvents, () => NOW)
    await store.connectGoogleAccount({
      connection: makeConnection(),
      credentialHomeBinding: HOME_BINDING,
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
    const store = createAtomicIntegrationCommandStore(db, silentEvents, () => NOW)

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
    const store = createAtomicIntegrationCommandStore(db, silentEvents, () => NOW)
    await store.connectGoogleAccount({
      connection: makeConnection(),
      credentialHomeBinding: HOME_BINDING,
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
    const rows = await pool.query(
      'SELECT access_version FROM google_connections WHERE id = $1',
      [CONN_ID],
    )
    expect(rows.rows).toEqual([{ access_version: 2 }])
    const facts = await pool.query(
      `SELECT id FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'integration.google_connection.visibility_changed'`,
      [ORG_ID],
    )
    expect(facts.rows).toHaveLength(1)
  })
})
