// Integration context — connect Google account use case tests

import { describe, it, expect } from 'vitest'
import { connectGoogleAccount } from './connect-google-account'
import { createInMemoryGoogleConnectionRepo } from '#/shared/testing/in-memory-google-connection-repo'
import { createSequentialIntegrationCommandStore } from '#/shared/testing/sequential-integration-command-store'
import { createInMemoryGoogleOAuthPort } from '#/shared/testing/in-memory-google-oauth-port'
import { createInMemoryTokenEncryption } from '#/shared/testing/in-memory-token-encryption'
import { createInMemoryPkceVerifierStore } from '#/shared/testing/in-memory-pkce-verifier-store'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import {
  buildTestAuthContext,
  buildTestGoogleConnection,
} from '#/shared/testing/fixtures'
import { isIntegrationError } from '../../domain/errors'
import { organizationId } from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

/** State nonce seeded with a PKCE verifier in every setup (BQC-7.6). */
const NONCE = 'test-state-nonce'
const VERIFIER = 'test-code-verifier'

const setup = () => {
  const connectionRepo = createInMemoryGoogleConnectionRepo()
  const oauth = createInMemoryGoogleOAuthPort()
  const encryption = createInMemoryTokenEncryption()
  const events = createCapturingEventBus()
  const pkceStore = createInMemoryPkceVerifierStore()
  // The fake applies synchronously — the verifier is in place before any
  // awaited use-case call below.
  void pkceStore.save(NONCE, VERIFIER, 600)
  const deps = {
    connectionRepo,
    oauth,
    encryption,
    commandStore: createSequentialIntegrationCommandStore({ connectionRepo, events }),
    clock: () => FIXED_TIME,
    idGen: () => 'test-connection-id',
    callbackUrl: 'http://localhost:3000/api/auth/google/callback',
    pkceStore,
  }
  const useCase = connectGoogleAccount(deps)
  return { useCase, connectionRepo, oauth, encryption, events, pkceStore }
}

describe('connectGoogleAccount', () => {
  it('creates a new connection, inserts into repo, emits event, and returns it', async () => {
    const { useCase, connectionRepo, events } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const result = await useCase(
      { code: 'valid-auth-code', visibility: 'private', stateNonce: NONCE },
      ctx,
    )

    expect(connectionRepo.all()).toHaveLength(1)
    expect(result.googleEmail).toBe('test@gmail.com')
    expect(result.status).toBe('active')
    expect(result.organizationId).toBe(ctx.organizationId)

    const emitted = events.capturedByTag('integration.google_account.connected')
    expect(emitted).toHaveLength(1)
    expect(emitted[0].connectionId).toBe(result.id)
    expect(emitted[0].googleEmail).toBe('test@gmail.com')
  })

  it('rejects users without integration.manage permission', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(
      useCase({ code: 'valid-auth-code', visibility: 'private', stateNonce: NONCE }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isIntegrationError(e) && (e as { code: string }).code === 'forbidden',
    )
  })

  it('propagates error when OAuth exchange fails', async () => {
    const { useCase, oauth } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    oauth.setExchangeError(new Error('OAuth provider unreachable'))

    await expect(
      useCase({ code: 'bad-code', visibility: 'private', stateNonce: NONCE }, ctx),
    ).rejects.toThrow('OAuth provider unreachable')
  })

  it('updates existing connection via updateReconnection when re-connecting', async () => {
    const { useCase, connectionRepo, events } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const existing = buildTestGoogleConnection({
      googleAccountId: 'google-account-123',
      googleEmail: 'test@gmail.com',
      status: 'disconnected',
      visibility: 'private',
    })
    connectionRepo.seed([existing])

    const result = await useCase(
      { code: 'valid-auth-code', visibility: 'organization', stateNonce: NONCE },
      ctx,
    )

    expect(result.id).toBe(existing.id)
    expect(result.status).toBe('active')
    expect(result.visibility).toBe('organization')
    expect(connectionRepo.all()).toHaveLength(1)

    const emitted = events.capturedByTag('integration.google_account.connected')
    expect(emitted).toHaveLength(1)
    expect(emitted[0].connectionId).toBe(existing.id)
  })

  it('rejects when the Google account is already connected in another org', async () => {
    const { useCase, connectionRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    // Same google account, DIFFERENT org → global-uniqueness boundary.
    const claimedElsewhere = buildTestGoogleConnection({
      googleAccountId: 'google-account-123',
      googleEmail: 'test@gmail.com',
      organizationId: organizationId('org-other'),
    })
    connectionRepo.seed([claimedElsewhere])

    await expect(
      useCase({ code: 'valid-auth-code', visibility: 'private', stateNonce: NONCE }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isIntegrationError(e) &&
        (e as { code: string }).code === 'account_already_connected',
    )
    // No new connection created in this org.
    expect(connectionRepo.all()).toHaveLength(1)
  })

  it('calculates token expiry from OAuth result expiresIn', async () => {
    const { useCase, connectionRepo, oauth } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    oauth.setExchangeResult({
      googleAccountId: 'google-account-123',
      googleEmail: 'test@gmail.com',
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      expiresIn: 7200,
      scopes: ['https://www.googleapis.com/auth/business.manage'],
    })

    await useCase(
      { code: 'valid-auth-code', visibility: 'private', stateNonce: NONCE },
      ctx,
    )

    const connection = connectionRepo.all()[0]
    // FIXED_TIME + 7200 * 1000 = 2026-04-10T14:00:00Z
    expect(connection.tokenExpiresAt).toEqual(new Date('2026-04-10T14:00:00Z'))
  })

  it('passes visibility through to the built connection', async () => {
    const { useCase, connectionRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await useCase(
      { code: 'valid-auth-code', visibility: 'organization', stateNonce: NONCE },
      ctx,
    )

    const connection = connectionRepo.all()[0]
    expect(connection.visibility).toBe('organization')
  })

  // ── PKCE (BQC-7.6) ────────────────────────────────────────────────

  it('redeems the verifier and forwards it to the token exchange', async () => {
    const { useCase, oauth } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await useCase(
      { code: 'valid-auth-code', visibility: 'private', stateNonce: NONCE },
      ctx,
    )

    expect(oauth.exchangeVerifierCalls()).toEqual([VERIFIER])
  })

  it('fails closed when the nonce has no stored verifier', async () => {
    const { useCase, oauth } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await expect(
      useCase(
        { code: 'valid-auth-code', visibility: 'private', stateNonce: 'unknown-nonce' },
        ctx,
      ),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isIntegrationError(e) && (e as { code: string }).code === 'oauth_state_invalid',
    )
    // The exchange must never run without a redeemed verifier.
    expect(oauth.exchangeVerifierCalls()).toEqual([])
  })

  it('verifier redemption is one-time (state replay fails closed)', async () => {
    const { useCase, pkceStore } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await useCase(
      { code: 'valid-auth-code', visibility: 'private', stateNonce: NONCE },
      ctx,
    )

    // The nonce was consumed by the first connect.
    expect(await pkceStore.redeem(NONCE)).toBeUndefined()
    await expect(
      useCase({ code: 'valid-auth-code', visibility: 'private', stateNonce: NONCE }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isIntegrationError(e) && (e as { code: string }).code === 'oauth_state_invalid',
    )
  })
})
