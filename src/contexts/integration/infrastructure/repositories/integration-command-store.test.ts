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
import { googleConnectionId, organizationId, userId } from '#/shared/domain/ids'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import type { GoogleConnection } from '../../domain/types'
import {
  integrationGoogleAccountConnected,
  integrationGoogleAccountDisconnected,
  integrationGoogleAccountReauthorizationRequired,
  integrationGoogleConnectionVisibilityChanged,
} from '../../domain/events'
import { isIntegrationError } from '../../domain/errors'
import { isUniqueViolationError } from '../../application/ports/google-connection.repository'
import { createAtomicIntegrationCommandStore } from '../integration-command-store'
import type { ReconnectGoogleAccountCommand } from '../../application/ports/integration-command-store.port'
import { createGoogleDisconnectRevokeRepository } from './google-disconnect-revoke.repository'
import { createGoogleOAuthExchangeRecoveryRepository } from './google-oauth-exchange-recovery.repository'

const ORG_ID = organizationId('org-intcmd-0000-0000-0000-000000000001')
const OTHER_ORG_ID = organizationId('org-intcmd-0000-0000-0000-000000000002')
const CONN_ID = googleConnectionId('6c000000-0000-0000-0000-000000000001')
const OTHER_CONN_ID = googleConnectionId('6c000000-0000-0000-0000-000000000003')
const INITIATOR_ID = userId('user-intcmd-00000000000000000001')
const EXCHANGE_ATTEMPT_ID = '6e000000-0000-4000-8000-000000000001'
const DISCONNECT_ATTEMPT_ID = '6e000000-0000-4000-8000-000000000002'
const CLEANUP_PERMIT_ID = '6e000000-0000-4000-8000-000000000003'
const NOW = new Date('2026-06-01T12:00:00.000Z')

let pool: Pool
let lease: TestLease
const db = getDb()

function makeConnection(overrides: Partial<GoogleConnection> = {}): GoogleConnection {
  return {
    id: CONN_ID,
    organizationId: ORG_ID,
    googleSubject: 'subject-intcmd-1',
    googleAccountEmail: null,
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

const disconnectedEvent = () =>
  integrationGoogleAccountDisconnected({
    connectionId: CONN_ID,
    organizationId: ORG_ID,
    occurredAt: NOW,
    userId: INITIATOR_ID,
  })

const reconnectCommand = (
  expected: ReconnectGoogleAccountCommand['expected'],
): ReconnectGoogleAccountCommand => ({
  organizationId: ORG_ID,
  connectionId: CONN_ID,
  expected,
  googleSubject: 'google-subject-2',
  googleAccountEmail: 'owner-2@example.com',
  scopes: ['openid', 'https://www.googleapis.com/auth/business.manage'],
  encryptedAccessToken: 'enc-a2',
  encryptedRefreshToken: 'enc-r2',
  tokenExpiresAt: new Date('2026-06-01T14:00:00.000Z'),
  visibility: 'organization',
  event: connectedEvent(),
})

const disconnectedFacts = async () =>
  (
    await pool.query<{ id: string }>(
      `SELECT id FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'integration.google_account.disconnected'`,
      [ORG_ID],
    )
  ).rows

/**
 * A governed revoke of CONN_ID that has taken the row into `disconnecting`:
 * the attempt was prepared against versions 1/1/1 and its dispatch bumped the
 * lifecycle version once (see google-disconnect-revoke.repository.ts).
 */
async function seedDispatchingDisconnect(cleanupDeadlineAt: Date) {
  const store = createAtomicIntegrationCommandStore(db, () => NOW)
  await store.connectGoogleAccount({
    connection: makeConnection({
      status: 'disconnecting',
      credentialUseState: 'cleanup_only',
      cleanupMaterialDeadlineAt: cleanupDeadlineAt,
      lifecycleVersion: 2,
    }),
    event: connectedEvent(),
  })
  await pool.query(
    `INSERT INTO idempotency_receipts (scope, key, payload, recorded_at)
     VALUES ('google_disconnect_revoke', $1, $2::jsonb, $3)`,
    [
      DISCONNECT_ATTEMPT_ID,
      JSON.stringify({
        id: DISCONNECT_ATTEMPT_ID,
        organizationId: ORG_ID,
        connectionId: CONN_ID,
        initiatorUserId: INITIATOR_ID,
        cleanupWorkPermitId: CLEANUP_PERMIT_ID,
        state: 'dispatching',
        expectedLifecycleVersion: 1,
        expectedAccessVersion: 1,
        expectedCredentialGeneration: 1,
        credentialBinding: null,
        cleanupDeadlineAt: cleanupDeadlineAt.toISOString(),
        activatedAt: NOW.toISOString(),
        dispatchingAt: NOW.toISOString(),
        terminalAt: null,
        outcomeCode: null,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      }),
      NOW,
    ],
  )
}

async function truncateAll(p: Pool) {
  const organizations = [ORG_ID, OTHER_ORG_ID]
  await p.query(
    `DELETE FROM idempotency_receipts
     WHERE scope IN ('google_oauth_exchange', 'google_disconnect_revoke')
       AND payload->>'organizationId' = ANY($1::text[])`,
    [organizations],
  )
  await p.query(
    'DELETE FROM google_connections WHERE organization_id = ANY($1::text[])',
    [organizations],
  )
  await p.query('DELETE FROM outbox_events WHERE organization_id = ANY($1::text[])', [
    organizations,
  ])
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
    const store = createAtomicIntegrationCommandStore(db, () => NOW)
    const event = connectedEvent()

    await store.connectGoogleAccount({
      connection: makeConnection(),
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
    const store = createAtomicIntegrationCommandStore(db, () => NOW)

    await store.connectGoogleAccount({
      connection: makeConnection(),
      exchangeAttemptId: EXCHANGE_ATTEMPT_ID,
      event: connectedEvent(),
    })

    const attempt = await pool.query(
      `SELECT
         payload->>'state' AS state,
         payload->>'encryptedResult' AS encrypted_result,
         payload->>'responseExpiresAt' AS response_expires_at,
         payload->>'applyLeaseExpiresAt' AS apply_lease_expires_at,
         payload->>'outcomeCode' AS outcome_code
       FROM idempotency_receipts
       WHERE scope = 'google_oauth_exchange' AND key = $1`,
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
    const store = createAtomicIntegrationCommandStore(db, () => NOW)
    const ghost = {
      ...connectedEvent(),
      _tag: 'integration.ghost',
    } as unknown as Parameters<typeof store.connectGoogleAccount>[0]['event']

    await expect(
      store.connectGoogleAccount({
        connection: makeConnection(),
        exchangeAttemptId: EXCHANGE_ATTEMPT_ID,
        event: ghost,
      }),
    ).rejects.toThrow(/Event type integration\.ghost:v1 is not registered for the outbox/)

    const connections = await pool.query(
      'SELECT id FROM google_connections WHERE organization_id = $1',
      [ORG_ID],
    )
    const attempt = await pool.query(
      `SELECT
         payload->>'state' AS state,
         payload->>'encryptedResult' AS encrypted_result
       FROM idempotency_receipts
       WHERE scope = 'google_oauth_exchange' AND key = $1`,
      [EXCHANGE_ATTEMPT_ID],
    )
    expect(connections.rows).toHaveLength(0)
    expect(attempt.rows[0]).toMatchObject({
      state: 'applying',
      encrypted_result: 'application-encrypted-provider-response',
    })
  })

  it('connectGoogleAccount rolls back the insert when the fact insert fails (unregistered type)', async () => {
    const store = createAtomicIntegrationCommandStore(db, () => NOW)
    const ghost = {
      ...connectedEvent(),
      _tag: 'integration.ghost',
    } as unknown as Parameters<typeof store.connectGoogleAccount>[0]['event']

    await expect(
      store.connectGoogleAccount({
        connection: makeConnection(),
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
    const store = createAtomicIntegrationCommandStore(db, () => NOW)
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
    const store = createAtomicIntegrationCommandStore(db, () => NOW)
    await store.connectGoogleAccount({
      connection: makeConnection(),
      event: connectedEvent(),
    })

    const updated = await store.reconnectGoogleAccount(
      reconnectCommand({
        lifecycleVersion: 1,
        accessVersion: 1,
        credentialGeneration: 1,
      }),
    )

    expect(updated).toMatchObject({
      googleSubject: 'google-subject-2',
      googleAccountEmail: 'owner-2@example.com',
      scopes: ['openid', 'https://www.googleapis.com/auth/business.manage'],
      visibility: 'organization',
    })
    const rows = await pool.query(
      'SELECT google_subject, google_account_email, encrypted_access_token, scopes, visibility, status FROM google_connections WHERE id = $1',
      [CONN_ID],
    )
    expect(rows.rows[0]).toMatchObject({
      google_subject: 'google-subject-2',
      google_account_email: 'owner-2@example.com',
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

  it('reconnectGoogleAccount refuses versions a disconnect moved and leaves the row disconnected — no fact', async () => {
    const store = createAtomicIntegrationCommandStore(db, () => NOW)
    await store.connectGoogleAccount({
      connection: makeConnection(),
      event: connectedEvent(),
    })
    await store.disconnectGoogleAccount({
      organizationId: ORG_ID,
      connectionId: CONN_ID,
      event: disconnectedEvent(),
    })

    // The ceremony was approved against the row as it stood before the
    // disconnect committed.
    await expect(
      store.reconnectGoogleAccount(
        reconnectCommand({
          lifecycleVersion: 1,
          accessVersion: 1,
          credentialGeneration: 1,
        }),
      ),
    ).rejects.toSatisfy(
      (e: unknown) => isIntegrationError(e) && e.code === 'oauth_failed',
    )

    const rows = await pool.query(
      `SELECT status, credential_use_state, encrypted_access_token, google_subject
         FROM google_connections WHERE id = $1`,
      [CONN_ID],
    )
    expect(rows.rows).toEqual([
      {
        status: 'disconnected',
        credential_use_state: 'none',
        encrypted_access_token: 'redacted',
        google_subject: null,
      },
    ])
    const facts = await pool.query(
      `SELECT COUNT(*)::int AS n FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'integration.google_account.connected'`,
      [ORG_ID],
    )
    expect(facts.rows[0].n).toBe(1)
  })

  it('reconnectGoogleAccount throws connection_not_found for a missing row — no fact', async () => {
    const store = createAtomicIntegrationCommandStore(db, () => NOW)

    await expect(
      store.reconnectGoogleAccount(
        reconnectCommand({
          lifecycleVersion: 1,
          accessVersion: 1,
          credentialGeneration: 1,
        }),
      ),
    ).rejects.toSatisfy(
      (e: unknown) => isIntegrationError(e) && e.code === 'connection_not_found',
    )

    const facts = await pool.query(
      'SELECT id FROM outbox_events WHERE organization_id = $1',
      [ORG_ID],
    )
    expect(facts.rows).toHaveLength(0)
  })

  it('disconnectGoogleAccount commits status + redaction + fact in one transaction', async () => {
    const store = createAtomicIntegrationCommandStore(db, () => NOW)
    await store.connectGoogleAccount({
      connection: makeConnection({ googleAccountEmail: 'owner@example.com' }),
      event: connectedEvent(),
    })
    const event = integrationGoogleAccountDisconnected({
      connectionId: CONN_ID,
      organizationId: ORG_ID,
      occurredAt: NOW,
      userId: null,
    })

    const result = await store.disconnectGoogleAccount({
      organizationId: ORG_ID,
      connectionId: CONN_ID,
      event,
    })

    expect(result.status).toBe('disconnected')
    const rows = await pool.query(
      'SELECT status, encrypted_access_token, google_subject, google_account_email, scopes FROM google_connections WHERE id = $1',
      [CONN_ID],
    )
    expect(rows.rows[0]).toMatchObject({
      status: 'disconnected',
      encrypted_access_token: 'redacted',
      google_subject: null,
      google_account_email: null,
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
    const store = createAtomicIntegrationCommandStore(db, () => NOW)
    await store.connectGoogleAccount({
      connection: makeConnection(),
      event: connectedEvent(),
    })
    const ghost = {
      ...integrationGoogleAccountDisconnected({
        connectionId: CONN_ID,
        organizationId: ORG_ID,
        occurredAt: NOW,
        userId: null,
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
    const store = createAtomicIntegrationCommandStore(db, () => NOW)

    await expect(
      store.disconnectGoogleAccount({
        organizationId: ORG_ID,
        connectionId: CONN_ID,
        event: integrationGoogleAccountDisconnected({
          connectionId: CONN_ID,
          organizationId: ORG_ID,
          occurredAt: NOW,
          userId: null,
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

  it("disconnectGoogleAccount never reaches another organization's connection", async () => {
    const store = createAtomicIntegrationCommandStore(db, () => NOW)
    await store.connectGoogleAccount({
      connection: makeConnection({
        id: OTHER_CONN_ID,
        organizationId: OTHER_ORG_ID,
        googleSubject: 'subject-intcmd-other',
      }),
      event: integrationGoogleAccountConnected({
        connectionId: OTHER_CONN_ID,
        organizationId: OTHER_ORG_ID,
        userId: INITIATOR_ID,
        occurredAt: NOW,
      }),
    })

    await expect(
      store.disconnectGoogleAccount({
        organizationId: ORG_ID,
        connectionId: OTHER_CONN_ID,
        event: integrationGoogleAccountDisconnected({
          connectionId: OTHER_CONN_ID,
          organizationId: ORG_ID,
          occurredAt: NOW,
          userId: null,
        }),
      }),
    ).rejects.toSatisfy(
      (e: unknown) => isIntegrationError(e) && e.code === 'connection_not_found',
    )

    const rows = await pool.query(
      `SELECT organization_id, status, encrypted_access_token
         FROM google_connections WHERE id = $1`,
      [OTHER_CONN_ID],
    )
    expect(rows.rows).toEqual([
      {
        organization_id: OTHER_ORG_ID,
        status: 'active',
        encrypted_access_token: 'enc-a',
      },
    ])
    const facts = await pool.query(
      `SELECT id FROM outbox_events
       WHERE organization_id = ANY($1::text[])
         AND event_type = 'integration.google_account.disconnected'`,
      [[ORG_ID, OTHER_ORG_ID]],
    )
    expect(facts.rows).toEqual([])
  })

  it('disconnectGoogleAccount returns an already-disconnected row without a second fact', async () => {
    const store = createAtomicIntegrationCommandStore(db, () => NOW)
    await store.connectGoogleAccount({
      connection: makeConnection(),
      event: connectedEvent(),
    })
    const first = disconnectedEvent()
    await store.disconnectGoogleAccount({
      organizationId: ORG_ID,
      connectionId: CONN_ID,
      event: first,
    })
    const versions = () =>
      pool.query(
        `SELECT lifecycle_version, access_version, credential_generation
           FROM google_connections WHERE id = $1`,
        [CONN_ID],
      )
    const before = await versions()

    await expect(
      store.disconnectGoogleAccount({
        organizationId: ORG_ID,
        connectionId: CONN_ID,
        event: disconnectedEvent(),
      }),
    ).resolves.toMatchObject({
      status: 'disconnected',
      encryptedRefreshToken: 'redacted',
    })

    expect((await versions()).rows).toEqual(before.rows)
    await expect(disconnectedFacts()).resolves.toEqual([{ id: first.eventId }])
  })

  it('disconnectGoogleAccount leaves a governed disconnect in flight to its attempt, whose settle still redacts', async () => {
    await seedDispatchingDisconnect(new Date(NOW.getTime() + 30_000))
    const store = createAtomicIntegrationCommandStore(db, () => NOW)

    await expect(
      store.disconnectGoogleAccount({
        organizationId: ORG_ID,
        connectionId: CONN_ID,
        event: disconnectedEvent(),
      }),
    ).rejects.toSatisfy(
      (e: unknown) => isIntegrationError(e) && e.code === 'invalid_transition',
    )
    const rows = await pool.query(
      `SELECT status, credential_use_state, encrypted_refresh_token, lifecycle_version
         FROM google_connections WHERE id = $1`,
      [CONN_ID],
    )
    expect(rows.rows).toEqual([
      {
        status: 'disconnecting',
        credential_use_state: 'cleanup_only',
        encrypted_refresh_token: 'enc-r',
        lifecycle_version: 2,
      },
    ])
    await expect(disconnectedFacts()).resolves.toEqual([])

    // Before this fence the local write consumed the row and this settle could
    // only fail, leaving the attempt dispatching for good.
    const settledEvent = disconnectedEvent()
    await expect(
      createGoogleDisconnectRevokeRepository(db).settle({
        attemptId: DISCONNECT_ATTEMPT_ID,
        organizationId: ORG_ID,
        connectionId: CONN_ID,
        initiatorUserId: INITIATOR_ID,
        outcome: 'confirmed_revoked',
        outcomeCode: 'google_revoke_confirmed',
        event: settledEvent,
        now: NOW,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { status: 'disconnected', credentialUseState: 'none', googleSubject: null },
    })
    await expect(disconnectedFacts()).resolves.toEqual([{ id: settledEvent.eventId }])
  })

  it('disconnectGoogleAccount finishes a disconnecting row locally once its cleanup window has closed', async () => {
    await seedDispatchingDisconnect(new Date(NOW.getTime() - 1))
    const store = createAtomicIntegrationCommandStore(db, () => NOW)
    const event = disconnectedEvent()

    await expect(
      store.disconnectGoogleAccount({
        organizationId: ORG_ID,
        connectionId: CONN_ID,
        event,
      }),
    ).resolves.toMatchObject({
      status: 'disconnected',
      credentialUseState: 'none',
      cleanupMaterialDeadlineAt: null,
    })
    const rows = await pool.query(
      `SELECT status, encrypted_refresh_token, google_subject
         FROM google_connections WHERE id = $1`,
      [CONN_ID],
    )
    expect(rows.rows).toEqual([
      {
        status: 'disconnected',
        encrypted_refresh_token: 'redacted',
        google_subject: null,
      },
    ])
    await expect(disconnectedFacts()).resolves.toEqual([{ id: event.eventId }])
  })

  it('updateConnectionVisibility commits the update + fact in one transaction', async () => {
    const store = createAtomicIntegrationCommandStore(db, () => NOW)
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

  const revokedEvent = () =>
    integrationGoogleAccountReauthorizationRequired({
      connectionId: CONN_ID,
      organizationId: ORG_ID,
      cause: 'provider_revoked',
      occurredAt: NOW,
    })

  it('requireReauthorization commits reauth_required + the reauthorization fact in one transaction', async () => {
    const store = createAtomicIntegrationCommandStore(db, () => NOW)
    await store.connectGoogleAccount({
      connection: makeConnection({
        lifecycleVersion: 4,
        accessVersion: 9,
        credentialGeneration: 6,
      }),
      event: connectedEvent(),
    })
    const event = revokedEvent()

    await expect(
      store.requireReauthorization({
        organizationId: ORG_ID,
        connectionId: CONN_ID,
        expected: { lifecycleVersion: 4, credentialGeneration: 6 },
        event,
      }),
    ).resolves.toBe(true)

    const rows = await pool.query(
      `SELECT status, status_reason, status_changed_at, credential_use_state,
              lifecycle_version, access_version, credential_generation,
              encrypted_refresh_token
         FROM google_connections WHERE id = $1`,
      [CONN_ID],
    )
    expect(rows.rows).toEqual([
      {
        status: 'reauth_required',
        status_reason: 'provider_revoked',
        status_changed_at: NOW,
        credential_use_state: 'active',
        lifecycle_version: 5,
        access_version: 10,
        credential_generation: 6,
        encrypted_refresh_token: 'enc-r',
      },
    ])
    const facts = await pool.query(
      `SELECT event_version, payload, source_aggregate_id FROM outbox_events
       WHERE organization_id = $1
         AND event_type = 'integration.google_account.reauthorization_required'
         AND id = $2`,
      [ORG_ID, event.eventId],
    )
    expect(facts.rows).toEqual([
      {
        event_version: 1,
        source_aggregate_id: CONN_ID,
        payload: {
          connectionId: CONN_ID,
          organizationId: ORG_ID,
          cause: 'provider_revoked',
          occurredAt: NOW.toISOString(),
          correlationId: null,
        },
      },
    ])
  })

  it('requireReauthorization leaves a newer grant alone and records nothing', async () => {
    const store = createAtomicIntegrationCommandStore(db, () => NOW)
    await store.connectGoogleAccount({
      connection: makeConnection({ lifecycleVersion: 5, credentialGeneration: 7 }),
      event: connectedEvent(),
    })

    // The refresh started from generation 6; a reconnect has committed 7.
    await expect(
      store.requireReauthorization({
        organizationId: ORG_ID,
        connectionId: CONN_ID,
        expected: { lifecycleVersion: 4, credentialGeneration: 6 },
        event: revokedEvent(),
      }),
    ).resolves.toBe(false)

    const rows = await pool.query(
      'SELECT status, lifecycle_version FROM google_connections WHERE id = $1',
      [CONN_ID],
    )
    expect(rows.rows).toEqual([{ status: 'active', lifecycle_version: 5 }])
    const facts = await pool.query(
      `SELECT id FROM outbox_events
       WHERE organization_id = $1
         AND event_type = 'integration.google_account.reauthorization_required'`,
      [ORG_ID],
    )
    expect(facts.rows).toEqual([])
  })

  it('requireReauthorization rolls the status back when the fact cannot commit', async () => {
    const store = createAtomicIntegrationCommandStore(db, () => NOW)
    await store.connectGoogleAccount({
      connection: makeConnection(),
      event: connectedEvent(),
    })
    const ghost = {
      ...revokedEvent(),
      _tag: 'integration.ghost',
    } as unknown as Parameters<typeof store.requireReauthorization>[0]['event']

    await expect(
      store.requireReauthorization({
        organizationId: ORG_ID,
        connectionId: CONN_ID,
        expected: { lifecycleVersion: 1, credentialGeneration: 1 },
        event: ghost,
      }),
    ).rejects.toThrow(/Event type integration\.ghost:v1 is not registered for the outbox/)

    const rows = await pool.query(
      'SELECT status, lifecycle_version FROM google_connections WHERE id = $1',
      [CONN_ID],
    )
    expect(rows.rows).toEqual([{ status: 'active', lifecycle_version: 1 }])
  })
})
