// Integration command store integration tests (real Postgres): disconnect,
// including a governed disconnect in flight and elapsed-attempt reconciliation.

import { describe, it, expect } from 'vitest'
import { unregisteredFact } from '#/shared/testing/unregistered-fact'
import {
  integrationGoogleAccountConnected,
  integrationGoogleAccountDisconnected,
} from '../domain/events'
import { createGoogleDisconnectRevokeRepository } from './google-disconnect-revoke-repository.server'
import {
  CONN_ID,
  DISCONNECT_ATTEMPT_ID,
  INITIATOR_ID,
  NOW,
  ORG_ID,
  OTHER_CONN_ID,
  OTHER_ORG_ID,
  connect,
  connectionRow,
  db,
  disconnectedEvent,
  disconnectedFacts,
  expectIntegrationError,
  makeConnection,
  newStore,
  outboxFacts,
  seedDispatchingDisconnect,
  testPool,
  useCommandStoreDatabase,
} from './integration-command-store.test-fixtures'

const GHOST_REJECTION =
  /Event type integration\.ghost:v1 is not registered for the outbox/

useCommandStoreDatabase()

const disconnectCommand = (event = disconnectedEvent(null)) => ({
  organizationId: ORG_ID,
  connectionId: CONN_ID,
  event,
})

describe.sequential('integrationCommandStore disconnect (integration)', () => {
  it('disconnectGoogleAccount commits status + redaction + fact in one transaction', async () => {
    const store = newStore()
    await connect(store, { googleAccountEmail: 'owner@example.com' })
    const event = disconnectedEvent(null)

    const result = await store.disconnectGoogleAccount(disconnectCommand(event))

    expect(result.status).toBe('disconnected')
    const rows = await connectionRow(
      'status, encrypted_access_token, google_subject, google_account_email, scopes',
    )
    expect(rows[0]).toMatchObject({
      status: 'disconnected',
      encrypted_access_token: 'redacted',
      google_subject: null,
      google_account_email: null,
      scopes: [],
    })
    expect(
      await outboxFacts('integration.google_account.disconnected', event.eventId),
    ).toHaveLength(1)
  })

  it('disconnectGoogleAccount rolls back status + redaction when the fact insert fails', async () => {
    const store = newStore()
    await connect(store)

    await expect(
      store.disconnectGoogleAccount(
        disconnectCommand(unregisteredFact(disconnectedEvent(null), 'integration.ghost')),
      ),
    ).rejects.toThrow(GHOST_REJECTION)

    // The crash window is closed: no status flip, no redaction.
    expect((await connectionRow('status, encrypted_access_token'))[0]).toMatchObject({
      status: 'active',
      encrypted_access_token: 'enc-a',
    })
  })

  it('disconnectGoogleAccount throws connection_not_found for a missing row — no fact', async () => {
    await expectIntegrationError(
      newStore().disconnectGoogleAccount(disconnectCommand()),
      'connection_not_found',
    )

    const facts = await testPool().query(
      'SELECT id FROM outbox_events WHERE organization_id = $1',
      [ORG_ID],
    )
    expect(facts.rows).toHaveLength(0)
  })

  it("disconnectGoogleAccount never reaches another organization's connection", async () => {
    const store = newStore()
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

    await expectIntegrationError(
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
      'connection_not_found',
    )

    expect(
      await connectionRow(
        'organization_id, status, encrypted_access_token',
        OTHER_CONN_ID,
      ),
    ).toEqual([
      {
        organization_id: OTHER_ORG_ID,
        status: 'active',
        encrypted_access_token: 'enc-a',
      },
    ])
    const facts = await testPool().query(
      `SELECT id FROM outbox_events
       WHERE organization_id = ANY($1::text[])
         AND event_type = 'integration.google_account.disconnected'`,
      [[ORG_ID, OTHER_ORG_ID]],
    )
    expect(facts.rows).toEqual([])
  })

  it('disconnectGoogleAccount returns an already-disconnected row without a second fact', async () => {
    const store = newStore()
    await connect(store)
    const first = disconnectedEvent()
    await store.disconnectGoogleAccount(disconnectCommand(first))
    const versions = () =>
      connectionRow('lifecycle_version, access_version, credential_generation')
    const before = await versions()

    await expect(
      store.disconnectGoogleAccount(disconnectCommand(disconnectedEvent())),
    ).resolves.toMatchObject({
      status: 'disconnected',
      encryptedRefreshToken: 'redacted',
    })

    expect(await versions()).toEqual(before)
    await expect(disconnectedFacts()).resolves.toEqual([{ id: first.eventId }])
  })

  it('disconnectGoogleAccount leaves a governed disconnect in flight to its attempt, whose settle still redacts', async () => {
    await seedDispatchingDisconnect(new Date(NOW.getTime() + 30_000))

    await expectIntegrationError(
      newStore().disconnectGoogleAccount(disconnectCommand(disconnectedEvent())),
      'invalid_transition',
    )
    expect(
      await connectionRow(
        'status, credential_use_state, encrypted_refresh_token, lifecycle_version',
      ),
    ).toEqual([
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
    const event = disconnectedEvent()

    await expect(
      newStore().disconnectGoogleAccount(disconnectCommand(event)),
    ).resolves.toMatchObject({
      status: 'disconnected',
      credentialUseState: 'none',
      cleanupMaterialDeadlineAt: null,
    })
    expect(
      await connectionRow('status, encrypted_refresh_token, google_subject'),
    ).toEqual([
      {
        status: 'disconnected',
        encrypted_refresh_token: 'redacted',
        google_subject: null,
      },
    ])
    await expect(disconnectedFacts()).resolves.toEqual([{ id: event.eventId }])
  })

  it('reconcileElapsed closes an attempt whose row a later disconnect finished, without another fact', async () => {
    // The attempt's window closed without a settle, so a disconnect finished
    // the row locally; the attempt has nothing left to redact.
    await seedDispatchingDisconnect(new Date(NOW.getTime() - 1))
    const local = disconnectedEvent()
    await newStore().disconnectGoogleAccount(disconnectCommand(local))
    const connectionBefore = await connectionRow('*')
    const revoke = createGoogleDisconnectRevokeRepository(db)

    // Counts stay counts of redactions; the closed attempt is only visited.
    await expect(revoke.reconcileElapsed({ now: NOW, limit: 10 })).resolves.toEqual({
      visited: 1,
      confirmedNotSent: 0,
      cleanupAmbiguous: 0,
    })

    const attempt = await testPool().query(
      `SELECT payload->>'state' AS state,
              payload->>'outcomeCode' AS outcome_code,
              payload->>'terminalAt' AS terminal_at,
              payload->>'credentialBinding' AS credential_binding
         FROM idempotency_receipts
        WHERE scope = 'google_disconnect_revoke' AND key = $1`,
      [DISCONNECT_ATTEMPT_ID],
    )
    // Its cleanup permit is not on record, so whether Google received the
    // revoke is unknown: the attempt closes as ambiguous, never as not-sent.
    expect(attempt.rows).toEqual([
      {
        state: 'cleanup_ambiguous',
        outcome_code: 'reconciled_connection_changed',
        terminal_at: NOW.toISOString(),
        credential_binding: null,
      },
    ])
    expect(await connectionRow('*')).toEqual(connectionBefore)
    await expect(disconnectedFacts()).resolves.toEqual([{ id: local.eventId }])
    // A closed attempt is not visited again.
    await expect(revoke.reconcileElapsed({ now: NOW, limit: 10 })).resolves.toEqual({
      visited: 0,
      confirmedNotSent: 0,
      cleanupAmbiguous: 0,
    })
  })
})
