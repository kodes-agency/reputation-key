// Integration command store integration tests (real Postgres): connect,
// reconnect and reauthorization commands.
//
// Crash-boundary proofs on the real google_connections table: forced outbox
// failure rolls back state, happy paths co-commit state and facts, and global
// identity uniqueness maps to the domain race error.

import { describe, it, expect } from 'vitest'
import { googleConnectionId } from '#/shared/domain/ids'
import { unregisteredFact } from '#/shared/testing/unregistered-fact'
import { integrationGoogleAccountConnected } from '../domain/events'
import { isUniqueViolationError } from './google-connection-repository.port.server'
import {
  CONN_ID,
  EXCHANGE_ATTEMPT_ID,
  INITIATOR_ID,
  NOW,
  ORG_ID,
  connect,
  connectedEvent,
  connectionRow,
  disconnectedEvent,
  expectIntegrationError,
  makeConnection,
  newStore,
  outboxFacts,
  prepareExchangeAttempt,
  reconnectCommand,
  revokedEvent,
  testPool,
  useCommandStoreDatabase,
} from './integration-command-store.test-fixtures'

const CONNECTED = 'integration.google_account.connected'
const REAUTH_REQUIRED = 'integration.google_account.reauthorization_required'
const GHOST_REJECTION =
  /Event type integration\.ghost:v1 is not registered for the outbox/

useCommandStoreDatabase()

const exchangeAttempt = (columns: string) =>
  testPool().query(
    `SELECT ${columns}
       FROM idempotency_receipts
       WHERE scope = 'google_oauth_exchange' AND key = $1`,
    [EXCHANGE_ATTEMPT_ID],
  )

describe.sequential('integrationCommandStore (integration)', () => {
  it('connectGoogleAccount commits the connection + connected fact in one transaction', async () => {
    const event = connectedEvent()

    await connect(newStore(), {}, event)

    const rows = await testPool().query(
      'SELECT id, status FROM google_connections WHERE organization_id = $1',
      [ORG_ID],
    )
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0].status).toBe('active')
    const facts = await testPool().query(
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

    await newStore().connectGoogleAccount({
      connection: makeConnection(),
      exchangeAttemptId: EXCHANGE_ATTEMPT_ID,
      event: connectedEvent(),
    })

    const attempt = await exchangeAttempt(
      `payload->>'state' AS state,
         payload->>'encryptedResult' AS encrypted_result,
         payload->>'responseExpiresAt' AS response_expires_at,
         payload->>'applyLeaseExpiresAt' AS apply_lease_expires_at,
         payload->>'outcomeCode' AS outcome_code`,
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

    await expect(
      newStore().connectGoogleAccount({
        connection: makeConnection(),
        exchangeAttemptId: EXCHANGE_ATTEMPT_ID,
        event: unregisteredFact(connectedEvent(), 'integration.ghost'),
      }),
    ).rejects.toThrow(GHOST_REJECTION)

    const connections = await connectionRow('id')
    const attempt = await exchangeAttempt(
      `payload->>'state' AS state,
         payload->>'encryptedResult' AS encrypted_result`,
    )
    expect(connections).toHaveLength(0)
    expect(attempt.rows[0]).toMatchObject({
      state: 'applying',
      encrypted_result: 'application-encrypted-provider-response',
    })
  })

  it('connectGoogleAccount rolls back the insert when the fact insert fails (unregistered type)', async () => {
    await expect(
      connect(newStore(), {}, unregisteredFact(connectedEvent(), 'integration.ghost')),
    ).rejects.toThrow(GHOST_REJECTION)

    expect(await connectionRow('id')).toHaveLength(0)
  })

  it('connectGoogleAccount maps the global unique race to UniqueViolationError', async () => {
    const store = newStore()
    await connect(store)

    await expect(
      connect(store, { id: googleConnectionId('6c000000-0000-0000-0000-000000000002') }),
    ).rejects.toSatisfy((e: unknown) => isUniqueViolationError(e))
  })

  it('reconnectGoogleAccount commits token/visibility update + fact in one transaction', async () => {
    const store = newStore()
    await connect(store)

    const updated = await store.reconnectGoogleAccount(reconnectCommand())

    expect(updated).toMatchObject({
      googleSubject: 'google-subject-2',
      googleAccountEmail: 'owner-2@example.com',
      scopes: ['openid', 'https://www.googleapis.com/auth/business.manage'],
      visibility: 'organization',
    })
    const rows = await connectionRow(
      'google_subject, google_account_email, encrypted_access_token, scopes, visibility, status',
    )
    expect(rows[0]).toMatchObject({
      google_subject: 'google-subject-2',
      google_account_email: 'owner-2@example.com',
      encrypted_access_token: 'enc-a2',
      scopes: ['openid', 'https://www.googleapis.com/auth/business.manage'],
      visibility: 'organization',
      status: 'active',
    })
    expect(await outboxFacts(CONNECTED)).toHaveLength(2)
  })

  it('reconnectGoogleAccount after a revocation clears the reason and stamps the status change', async () => {
    const store = newStore()
    await connect(store, {
      lifecycleVersion: 4,
      accessVersion: 9,
      credentialGeneration: 6,
    })
    await store.requireReauthorization({
      organizationId: ORG_ID,
      connectionId: CONN_ID,
      expected: { lifecycleVersion: 4, credentialGeneration: 6 },
      event: revokedEvent(),
    })
    const reauthorizedAt = new Date('2026-06-02T09:30:00.000Z')

    await store.reconnectGoogleAccount({
      ...reconnectCommand({
        lifecycleVersion: 5,
        accessVersion: 10,
        credentialGeneration: 6,
      }),
      event: integrationGoogleAccountConnected({
        connectionId: CONN_ID,
        organizationId: ORG_ID,
        userId: INITIATOR_ID,
        occurredAt: reauthorizedAt,
      }),
    })

    expect(
      await connectionRow(
        'status, status_reason, status_changed_at, credential_authorized_at',
      ),
    ).toEqual([
      {
        status: 'active',
        status_reason: null,
        status_changed_at: reauthorizedAt,
        credential_authorized_at: reauthorizedAt,
      },
    ])
  })

  it('reconnectGoogleAccount refuses versions a disconnect moved and leaves the row disconnected — no fact', async () => {
    const store = newStore()
    await connect(store)
    await store.disconnectGoogleAccount({
      organizationId: ORG_ID,
      connectionId: CONN_ID,
      event: disconnectedEvent(),
    })

    // The ceremony was approved against the row as it stood before the
    // disconnect committed.
    await expectIntegrationError(
      store.reconnectGoogleAccount(reconnectCommand()),
      'oauth_failed',
    )

    expect(
      await connectionRow(
        'status, credential_use_state, encrypted_access_token, google_subject',
      ),
    ).toEqual([
      {
        status: 'disconnected',
        credential_use_state: 'none',
        encrypted_access_token: 'redacted',
        google_subject: null,
      },
    ])
    expect(await outboxFacts(CONNECTED)).toHaveLength(1)
  })

  it('reconnectGoogleAccount throws connection_not_found for a missing row — no fact', async () => {
    await expectIntegrationError(
      newStore().reconnectGoogleAccount(reconnectCommand()),
      'connection_not_found',
    )

    const facts = await testPool().query(
      'SELECT id FROM outbox_events WHERE organization_id = $1',
      [ORG_ID],
    )
    expect(facts.rows).toHaveLength(0)
  })

  it('requireReauthorization commits reauth_required + the reauthorization fact in one transaction', async () => {
    const store = newStore()
    await connect(store, {
      lifecycleVersion: 4,
      accessVersion: 9,
      credentialGeneration: 6,
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

    expect(
      await connectionRow(
        `status, status_reason, status_changed_at, credential_use_state,
              lifecycle_version, access_version, credential_generation,
              encrypted_refresh_token`,
      ),
    ).toEqual([
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
    const facts = await testPool().query(
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
    const store = newStore()
    await connect(store, { lifecycleVersion: 5, credentialGeneration: 7 })

    // The refresh started from generation 6; a reconnect has committed 7.
    await expect(
      store.requireReauthorization({
        organizationId: ORG_ID,
        connectionId: CONN_ID,
        expected: { lifecycleVersion: 4, credentialGeneration: 6 },
        event: revokedEvent(),
      }),
    ).resolves.toBe(false)

    expect(await connectionRow('status, lifecycle_version')).toEqual([
      { status: 'active', lifecycle_version: 5 },
    ])
    expect(await outboxFacts(REAUTH_REQUIRED)).toEqual([])
  })

  it('requireReauthorization rolls the status back when the fact cannot commit', async () => {
    const store = newStore()
    await connect(store)

    await expect(
      store.requireReauthorization({
        organizationId: ORG_ID,
        connectionId: CONN_ID,
        expected: { lifecycleVersion: 1, credentialGeneration: 1 },
        event: unregisteredFact(revokedEvent(), 'integration.ghost'),
      }),
    ).rejects.toThrow(GHOST_REJECTION)

    expect(await connectionRow('status, lifecycle_version')).toEqual([
      { status: 'active', lifecycle_version: 1 },
    ])
  })
})
