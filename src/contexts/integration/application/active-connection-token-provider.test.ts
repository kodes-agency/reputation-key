// Integration context — ActiveConnectionTokenProvider tests
// Owns the connection gate + token expiry decision table that listGbpLocations
// (and future callers) no longer know about.

import { describe, it, expect } from 'vitest'
import {
  createActiveConnectionTokenProvider,
  decideTokenFreshness,
} from './active-connection-token-provider'
import { TOKEN_EXPIRY_BUFFER_MS } from './constants'
import { createInMemoryGoogleConnectionRepo } from '#/shared/testing/in-memory-google-connection-repo'
import { createInMemoryTokenEncryption } from '#/shared/testing/in-memory-token-encryption'
import { buildTestGoogleConnection } from '#/shared/testing/fixtures'
import { organizationId } from '#/shared/domain/ids'
import { isIntegrationError } from '../domain/errors'

const FIXED_NOW = new Date('2026-06-01T12:00:00Z')
const ORG_ID = organizationId('org-00000000-0000-0000-0000-000000000001')

const setup = (
  connectionOverrides: Parameters<typeof buildTestGoogleConnection>[0] = {},
) => {
  const connectionRepo = createInMemoryGoogleConnectionRepo()
  const encryption = createInMemoryTokenEncryption()
  const conn = buildTestGoogleConnection({
    status: 'active',
    tokenExpiresAt: new Date(FIXED_NOW.getTime() + 3600_000),
    ...connectionOverrides,
  })
  connectionRepo.seed([conn])

  const refreshCalls: Array<{ orgId: string; connectionId: string }> = []
  const refreshGoogleToken = async (orgId: string, connectionId: string) => {
    refreshCalls.push({ orgId, connectionId })
    const existing = await connectionRepo.findById(orgId as never, connectionId as never)
    if (!existing) throw new Error('Connection not found for refresh')
    return {
      ...existing,
      encryptedAccessToken: 'enc:refreshed-access-token',
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
    const { provider, conn, encryption, refreshCalls } = setup()

    const token = await provider.getAccessToken(ORG_ID, conn.id as string)

    expect(token).toBe(encryption.decrypt(conn.encryptedAccessToken))
    expect(refreshCalls()).toHaveLength(0)
  })

  it('refreshes then decrypts when the token expires within the buffer', async () => {
    const almostExpired = new Date(FIXED_NOW.getTime() + 3 * 60 * 1000)
    const { provider, conn, refreshCalls } = setup({ tokenExpiresAt: almostExpired })

    const token = await provider.getAccessToken(ORG_ID, conn.id as string)

    expect(refreshCalls()).toHaveLength(1)
    expect(refreshCalls()[0].connectionId).toBe(conn.id as string)
    expect(token).toBe('refreshed-access-token')
  })

  it('rejects when the connection does not exist', async () => {
    const { provider } = setup()

    await expect(
      provider.getAccessToken(ORG_ID, 'nonexistent-0000-0000-0000-000000000001'),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isIntegrationError(e) && (e as { code: string }).code === 'connection_not_found',
    )
  })

  it('rejects when the connection is not active', async () => {
    const { provider, conn } = setup({ status: 'disconnected' })

    await expect(provider.getAccessToken(ORG_ID, conn.id as string)).rejects.toSatisfy(
      (e: unknown) =>
        isIntegrationError(e) &&
        (e as { code: string }).code === 'connection_disconnected',
    )
  })

  it.each(['cleanup_only', 'none'] as const)(
    'never decrypts or refreshes credentials in %s use state',
    async (credentialUseState) => {
      const { provider, conn, refreshCalls } = setup({ credentialUseState })

      await expect(provider.getAccessToken(ORG_ID, conn.id as string)).rejects.toSatisfy(
        (error: unknown) =>
          isIntegrationError(error) && error.code === 'connection_disconnected',
      )
      expect(refreshCalls()).toHaveLength(0)
    },
  )
})
