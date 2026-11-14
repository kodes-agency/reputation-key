// Integration context — ActiveConnectionTokenProvider tests
// Owns the connection gate + token expiry decision table that listGbpLocations
// (and future callers) no longer know about.

import { describe, it, expect } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import {
  createActiveConnectionTokenProvider,
  decideTokenFreshness,
} from './active-connection-token-provider'
import { TOKEN_EXPIRY_BUFFER_MS } from './constants'
import { createGoogleConnectionTestStore } from '#/contexts/integration/connections/google-connection.test-fixtures'
import { createTestTokenEncryption } from '#/contexts/integration/connections/token-encryption.test-fixtures'
import { buildTestGoogleConnection } from '#/shared/testing/fixtures'
import { organizationId } from '#/shared/domain/ids'
import { isIntegrationError } from '../domain/errors'

const FIXED_NOW = new Date('2026-06-01T12:00:00Z')
const ORG_ID = organizationId('org-token-provider-aa')
const OTHER_ORG_ID = organizationId('org-token-provider-bb')

setupIntegrationDb({
  orgA: ORG_ID,
  orgB: OTHER_ORG_ID,
  tables: ['google_connections'],
})

const setup = async (
  connectionOverrides: Parameters<typeof buildTestGoogleConnection>[0] = {},
) => {
  const connectionRepo = createGoogleConnectionTestStore(getDb(), () => FIXED_NOW, [
    ORG_ID,
  ])
  const encryption = createTestTokenEncryption()
  const conn = buildTestGoogleConnection({
    organizationId: ORG_ID,
    encryptedAccessToken: encryption.encrypt('stored-access-token'),
    status: 'active',
    tokenExpiresAt: new Date(FIXED_NOW.getTime() + 3600_000),
    ...connectionOverrides,
  })
  await connectionRepo.seed([conn])

  const refreshCalls: Array<{ orgId: string; connectionId: string }> = []
  const refreshGoogleToken = async (orgId: string, connectionId: string) => {
    refreshCalls.push({ orgId, connectionId })
    const existing = await connectionRepo.findById(orgId as never, connectionId as never)
    if (!existing) throw new Error('Connection not found for refresh')
    return {
      ...existing,
      encryptedAccessToken: encryption.encrypt('refreshed-access-token'),
      tokenExpiresAt: new Date(FIXED_NOW.getTime() + 3600_000),
    }
  }

  const provider = createActiveConnectionTokenProvider({
    connectionRepo,
    encryption,
    clock: () => FIXED_NOW,
    refreshGoogleToken: refreshGoogleToken as never,
  })

  return { provider, conn, encryption, refreshCalls: () => refreshCalls }
}

// ── Token expiry decision table (pure) ──────────────────────────
//
//   expiresAt ≤ now + TOKEN_EXPIRY_BUFFER_MS → refresh-required
//   expiresAt > now + TOKEN_EXPIRY_BUFFER_MS → fresh

describe('decideTokenFreshness', () => {
  const nowMs = FIXED_NOW.getTime()

  it('requires refresh when the token expires inside the buffer', () => {
    expect(decideTokenFreshness(nowMs + TOKEN_EXPIRY_BUFFER_MS - 1, nowMs)).toBe(
      'refresh-required',
    )
  })

  it('requires refresh when the token expires exactly at the buffer boundary', () => {
    expect(decideTokenFreshness(nowMs + TOKEN_EXPIRY_BUFFER_MS, nowMs)).toBe(
      'refresh-required',
    )
  })

  it('requires refresh when the token is already expired', () => {
    expect(decideTokenFreshness(nowMs - 1, nowMs)).toBe('refresh-required')
  })

  it('is fresh when the token expires beyond the buffer', () => {
    expect(decideTokenFreshness(nowMs + TOKEN_EXPIRY_BUFFER_MS + 1, nowMs)).toBe('fresh')
  })
})

// ── Provider pipeline ───────────────────────────────────────────

describe('ActiveConnectionTokenProvider.getAccessToken', () => {
  it('decrypts the stored token when fresh — no refresh call', async () => {
    const { provider, conn, refreshCalls } = await setup()

    const token = await provider.getAccessToken(ORG_ID, conn.id as string)

    expect(token).toBe('stored-access-token')
    expect(refreshCalls()).toHaveLength(0)
  })

  it('refreshes then decrypts when the token expires within the buffer', async () => {
    const almostExpired = new Date(FIXED_NOW.getTime() + 3 * 60 * 1000)
    const { provider, conn, refreshCalls } = await setup({
      tokenExpiresAt: almostExpired,
    })

    const token = await provider.getAccessToken(ORG_ID, conn.id as string)

    expect(refreshCalls()).toHaveLength(1)
    expect(refreshCalls()[0]?.connectionId).toBe(conn.id as string)
    expect(token).toBe('refreshed-access-token')
  })

  it('forces one provider refresh after a 401 even when the stored access token is fresh', async () => {
    const { provider, conn, refreshCalls } = await setup()

    const token = await provider.forceRefreshAccessToken(
      ORG_ID,
      conn.id as string,
      conn.credentialGeneration,
    )

    expect(refreshCalls()).toEqual([{ orgId: ORG_ID, connectionId: conn.id }])
    expect(token).toBe('refreshed-access-token')
  })

  it('rejects when the connection does not exist', async () => {
    const { provider } = await setup()

    await expect(
      provider.getAccessToken(ORG_ID, 'e0000009-0000-0000-0000-000000000009'),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isIntegrationError(e) && (e as { code: string }).code === 'connection_not_found',
    )
  })

  it('rejects when the connection is not active', async () => {
    const { provider, conn } = await setup({ status: 'disconnected' })

    await expect(provider.getAccessToken(ORG_ID, conn.id as string)).rejects.toSatisfy(
      (e: unknown) =>
        isIntegrationError(e) &&
        (e as { code: string }).code === 'connection_disconnected',
    )
  })

  // A connection Google revoked says so, so a forced refresh after a 401 can
  // tell the caller the answered 401 is final rather than an unknown outcome.
  it('refuses a connection waiting for reauthorization without refreshing it', async () => {
    const { provider, conn, refreshCalls } = await setup({ status: 'reauth_required' })
    const waitingForConsent = (e: unknown) =>
      isIntegrationError(e) && e.code === 'reauthorization_required'

    await expect(provider.getAccessToken(ORG_ID, conn.id as string)).rejects.toSatisfy(
      waitingForConsent,
    )
    await expect(
      provider.forceRefreshAccessToken(
        ORG_ID,
        conn.id as string,
        conn.credentialGeneration,
      ),
    ).rejects.toSatisfy(waitingForConsent)
    expect(refreshCalls()).toHaveLength(0)
  })

  it.each(['cleanup_only', 'none'] as const)(
    'never decrypts or refreshes credentials in %s use state',
    async (credentialUseState) => {
      const { provider, conn, refreshCalls } = await setup({ credentialUseState })

      await expect(provider.getAccessToken(ORG_ID, conn.id as string)).rejects.toSatisfy(
        (error: unknown) =>
          isIntegrationError(error) && error.code === 'connection_disconnected',
      )
      expect(refreshCalls()).toHaveLength(0)
    },
  )
})
