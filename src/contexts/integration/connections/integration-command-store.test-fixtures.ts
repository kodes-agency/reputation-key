// Shared arrangement for the integration command store integration tests.

import { afterAll, beforeAll, beforeEach, expect } from 'vitest'
import type { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { googleConnectionId, organizationId, userId } from '#/shared/domain/ids'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { GOOGLE_BUSINESS_MANAGE_SCOPE } from '../provider/contracts'
import type { GoogleConnection } from '../domain/types'
import {
  integrationGoogleAccountConnected,
  integrationGoogleAccountDisconnected,
  integrationGoogleAccountReauthorizationRequired,
} from '../domain/events'
import { isIntegrationError } from '../domain/errors'
import { createAtomicIntegrationCommandStore } from './integration-command-store.server'
import type { ReconnectGoogleAccountCommand } from './integration-command-store.port.server'
import { createGoogleOAuthExchangeRecoveryRepository } from './google-oauth-exchange-recovery-repository.server'

export const ORG_ID = organizationId('org-intcmd-0000-0000-0000-000000000001')
export const OTHER_ORG_ID = organizationId('org-intcmd-0000-0000-0000-000000000002')
export const CONN_ID = googleConnectionId('6c000000-0000-0000-0000-000000000001')
export const OTHER_CONN_ID = googleConnectionId('6c000000-0000-0000-0000-000000000003')
export const INITIATOR_ID = userId('user-intcmd-00000000000000000001')
export const EXCHANGE_ATTEMPT_ID = '6e000000-0000-4000-8000-000000000001'
export const DISCONNECT_ATTEMPT_ID = '6e000000-0000-4000-8000-000000000002'
const CLEANUP_PERMIT_ID = '6e000000-0000-4000-8000-000000000003'
export const NOW = new Date('2026-06-01T12:00:00.000Z')

export const db = getDb()
let pool: Pool
let lease: TestLease

export const testPool = (): Pool => pool

export const newStore = () => createAtomicIntegrationCommandStore(db, () => NOW)

export type CommandStore = ReturnType<typeof newStore>

export function makeConnection(
  overrides: Partial<GoogleConnection> = {},
): GoogleConnection {
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

export const connectedEvent = () =>
  integrationGoogleAccountConnected({
    connectionId: CONN_ID,
    organizationId: ORG_ID,
    userId: INITIATOR_ID,
    occurredAt: NOW,
  })

export const disconnectedEvent = (
  eventUserId: typeof INITIATOR_ID | null = INITIATOR_ID,
) =>
  integrationGoogleAccountDisconnected({
    connectionId: CONN_ID,
    organizationId: ORG_ID,
    occurredAt: NOW,
    userId: eventUserId,
  })

export const revokedEvent = () =>
  integrationGoogleAccountReauthorizationRequired({
    connectionId: CONN_ID,
    organizationId: ORG_ID,
    cause: 'provider_revoked',
    occurredAt: NOW,
  })

export const reconnectCommand = (
  expected: ReconnectGoogleAccountCommand['expected'] = {
    lifecycleVersion: 1,
    accessVersion: 1,
    credentialGeneration: 1,
  },
): ReconnectGoogleAccountCommand => ({
  organizationId: ORG_ID,
  connectionId: CONN_ID,
  expected,
  googleSubject: 'google-subject-2',
  googleAccountEmail: 'owner-2@example.com',
  scopes: ['openid', GOOGLE_BUSINESS_MANAGE_SCOPE],
  encryptedAccessToken: 'enc-a2',
  encryptedRefreshToken: 'enc-r2',
  tokenExpiresAt: new Date('2026-06-01T14:00:00.000Z'),
  visibility: 'organization',
  event: connectedEvent(),
})

/** Inserts a connection through the store with the standard connected fact. */
export const connect = (
  store: CommandStore,
  overrides: Partial<GoogleConnection> = {},
  event = connectedEvent(),
) => store.connectGoogleAccount({ connection: makeConnection(overrides), event })

/** Reads the given google_connections columns of one connection. */
export async function connectionRow(columns: string, id: string = CONN_ID) {
  const result = await pool.query(
    `SELECT ${columns} FROM google_connections WHERE id = $1`,
    [id],
  )
  return result.rows
}

/** Reads the ids of outbox facts of one type for ORG_ID, optionally one event. */
export async function outboxFacts(type: string, eventId?: string) {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM outbox_events
     WHERE organization_id = $1 AND event_type = $2 AND ($3::text IS NULL OR id::text = $3)`,
    [ORG_ID, type, eventId ?? null],
  )
  return result.rows
}

export const disconnectedFacts = () =>
  outboxFacts('integration.google_account.disconnected')

export async function expectIntegrationError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy(
    (e: unknown) => isIntegrationError(e) && e.code === code,
  )
}

/**
 * A governed revoke of CONN_ID that has taken the row into `disconnecting`:
 * the attempt was prepared against versions 1/1/1 and its dispatch bumped the
 * lifecycle version once (see google-disconnect-revoke-repository.server.ts).
 */
export async function seedDispatchingDisconnect(cleanupDeadlineAt: Date) {
  await connect(newStore(), {
    status: 'disconnecting',
    credentialUseState: 'cleanup_only',
    cleanupMaterialDeadlineAt: cleanupDeadlineAt,
    lifecycleVersion: 2,
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

export async function prepareExchangeAttempt(id = EXCHANGE_ATTEMPT_ID) {
  const recovery = createGoogleOAuthExchangeRecoveryRepository(db)
  const actor = { id, organizationId: ORG_ID, initiatorUserId: INITIATOR_ID }
  await recovery.begin({
    ...actor,
    connectionId: CONN_ID,
    connectionMode: 'new' as const,
    targetConnectionId: null,
    expectedLifecycleVersion: 0,
    expectedAccessVersion: 0,
    expectedCredentialGeneration: 0,
    now: NOW,
  })
  await recovery.markProviderStarted({ ...actor, now: NOW })
  await recovery.preserveSuccessfulResult({
    ...actor,
    encryptedResult: 'application-encrypted-provider-response',
    now: NOW,
  })
  await recovery.claimPreservedResult({ ...actor, now: NOW })
  return recovery
}

/** Registers the lease, event schemas and per-test cleanup for a suite file. */
export function useCommandStoreDatabase() {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
    pool = lease.pool
  })
  afterAll(async () => {
    await truncateAll(pool)
    await lease.release()
  })
  beforeEach(async () => {
    await truncateAll(pool)
  })
}
