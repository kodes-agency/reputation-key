// Integration context — ActiveConnectionTokenProvider
// Deep module: resolves the active Google connection and hands out a usable
// access token. Callers no longer know about:
//   - the connection lookup + status gate (connection_not_found / connection_disconnected)
//   - the token expiry decision table (decideTokenFreshness)
//   - the refresh-vs-decrypt branching and the TOKEN_EXPIRY_BUFFER_MS constant

import type { GoogleConnectionRepository } from './ports/google-connection.repository'
import type { TokenEncryptionPort } from './ports/token-encryption.port'
import type { GoogleConnection } from '../domain/types'
import { integrationError } from '../domain/errors'
import { googleConnectionId, type OrganizationId } from '#/shared/domain/ids'
import { TOKEN_EXPIRY_BUFFER_MS } from './constants'
import type { AssertDirectGoogleCredentialUse } from './google-credential-execution-gate'

export type ActiveConnectionTokenProviderDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
  encryption: TokenEncryptionPort
  clock: () => Date
  refreshGoogleToken: (
    orgId: OrganizationId,
    connectionId: string,
    options?: Readonly<{
      force?: boolean
      expectedCredentialGeneration?: number
    }>,
  ) => Promise<GoogleConnection>
  assertDirectCredentialUse: AssertDirectGoogleCredentialUse
}>

// ── Token expiry decision table (pure) ──────────────────────────
//
//   expiresAt ≤ now + TOKEN_EXPIRY_BUFFER_MS → refresh-required (proactive refresh)
//   expiresAt > now + TOKEN_EXPIRY_BUFFER_MS → fresh (decrypt the stored token)

export type TokenFreshness = 'fresh' | 'refresh-required'

export function decideTokenFreshness(expiresAtMs: number, nowMs: number): TokenFreshness {
  return expiresAtMs <= nowMs + TOKEN_EXPIRY_BUFFER_MS ? 'refresh-required' : 'fresh'
}

// ── Provider ────────────────────────────────────────────────────

export type ActiveConnectionTokenProvider = Readonly<{
  /** Access token for the org's active connection — refreshing it first when stale. */
  getAccessToken: (
    orgId: OrganizationId,
    connectionId: string,
    propertyIds?: readonly string[],
  ) => Promise<string>
  /** Force a provider refresh after a 401, fenced to the credential that failed. */
  forceRefreshAccessToken: (
    orgId: OrganizationId,
    connectionId: string,
    expectedCredentialGeneration: number,
    propertyIds?: readonly string[],
  ) => Promise<string>
}>

export const createActiveConnectionTokenProvider = (
  deps: ActiveConnectionTokenProviderDeps,
): ActiveConnectionTokenProvider => {
  /** Find the connection and gate on active status — the only two failure modes callers see. */
  const getActiveConnection = async (
    orgId: OrganizationId,
    connectionId: string,
  ): Promise<GoogleConnection> => {
    const connection = await deps.connectionRepo.findById(
      orgId,
      googleConnectionId(connectionId),
    )
    if (!connection) {
      throw integrationError('connection_not_found', 'Google connection not found')
    }
    if (connection.status !== 'active' || connection.credentialUseState !== 'active') {
      throw integrationError('connection_disconnected', 'Google account is not connected')
    }
    return connection
  }

  return {
    getAccessToken: async (orgId, connectionId, propertyIds) => {
      const connection = await getActiveConnection(orgId, connectionId)
      await deps.assertDirectCredentialUse(connection, propertyIds)
      const freshness = decideTokenFreshness(
        connection.tokenExpiresAt.getTime(),
        deps.clock().getTime(),
      )
      if (freshness === 'refresh-required') {
        const refreshed = await deps.refreshGoogleToken(orgId, connectionId, {
          expectedCredentialGeneration: connection.credentialGeneration,
        })
        await deps.assertDirectCredentialUse(refreshed, propertyIds)
        return deps.encryption.decrypt(refreshed.encryptedAccessToken)
      }
      return deps.encryption.decrypt(connection.encryptedAccessToken)
    },
    forceRefreshAccessToken: async (
      orgId,
      connectionId,
      expectedCredentialGeneration,
      propertyIds,
    ) => {
      const connection = await getActiveConnection(orgId, connectionId)
      await deps.assertDirectCredentialUse(connection, propertyIds)
      if (connection.credentialGeneration !== expectedCredentialGeneration) {
        return deps.encryption.decrypt(connection.encryptedAccessToken)
      }
      const refreshed = await deps.refreshGoogleToken(orgId, connectionId, {
        force: true,
        expectedCredentialGeneration,
      })
      await deps.assertDirectCredentialUse(refreshed, propertyIds)
      return deps.encryption.decrypt(refreshed.encryptedAccessToken)
    },
  }
}
