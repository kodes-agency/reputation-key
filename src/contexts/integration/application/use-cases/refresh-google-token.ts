// Integration context — refresh Google token use case
// Called internally by sync jobs, not by users. Takes (orgId, connectionId) NOT AuthContext.
// Steps: find connection → check status → check expiry → decrypt → refresh → encrypt → update → return

import type { GoogleConnectionRepository } from '../ports/google-connection.repository'
import type { GoogleOAuthPort } from '../ports/google-oauth.port'
import type { TokenEncryptionPort } from '../ports/token-encryption.port'
import type { GoogleConnection } from '../../domain/types'
import type { OrganizationId } from '#/shared/domain/ids'
import { googleConnectionId } from '#/shared/domain/ids'
import { integrationError } from '../../domain/errors'
import { TOKEN_EXPIRY_BUFFER_MS } from '../constants'
import type { GoogleRefreshCoordination } from '../ports/google-refresh-coordination.port'

const REFRESH_COORDINATION_DEADLINE_MS = 25_000

export type RefreshGoogleTokenOptions = Readonly<{
  force?: boolean
  expectedCredentialGeneration?: number
}>

export type RefreshGoogleTokenDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
  oauth: GoogleOAuthPort
  encryption: TokenEncryptionPort
  clock: () => Date
  coordination?: GoogleRefreshCoordination
}>

export const refreshGoogleToken =
  (deps: RefreshGoogleTokenDeps) =>
  async (
    orgId: OrganizationId,
    connectionIdStr: string,
    options: RefreshGoogleTokenOptions = {},
  ): Promise<GoogleConnection> => {
    const connectionId = googleConnectionId(connectionIdStr)

    // 1. Find connection
    const connection = await deps.connectionRepo.findById(orgId, connectionId)
    if (!connection) {
      throw integrationError('connection_not_found', 'Google connection not found')
    }

    // 2. Check status
    if (connection.status !== 'active' || connection.credentialUseState !== 'active') {
      throw integrationError(
        'connection_disconnected',
        'Cannot refresh token for disconnected connection',
      )
    }

    // 3. Check if token needs refresh (5 min buffer)
    const now = deps.clock().getTime()
    const expiresAt = connection.tokenExpiresAt.getTime()

    if (!options.force && expiresAt > now + TOKEN_EXPIRY_BUFFER_MS) {
      return connection
    }
    if (
      options.expectedCredentialGeneration !== undefined &&
      connection.credentialGeneration !== options.expectedCredentialGeneration
    ) {
      return connection
    }

    const validateCurrentAuthority = (current: GoogleConnection): GoogleConnection => {
      if (current.status !== 'active' || current.credentialUseState !== 'active') {
        throw integrationError(
          'connection_disconnected',
          'Credential authority changed after token refresh',
        )
      }
      return current
    }

    const loadCommittedReplicaRefresh = async (): Promise<GoogleConnection | null> => {
      const latest = await deps.connectionRepo.findById(orgId, connectionId)
      if (!latest) {
        throw integrationError(
          'connection_not_found',
          'Connection not found during token refresh',
        )
      }
      if (latest.credentialGeneration === connection.credentialGeneration) return null
      return validateCurrentAuthority(latest)
    }

    const performRefresh = async (
      assertLeadership: () => Promise<void>,
    ): Promise<GoogleConnection> => {
      // Credential material is not decrypted until the replica owns the
      // renewable Redis lease and shared failure backoff has admitted it.
      const refreshToken = deps.encryption.decrypt(connection.encryptedRefreshToken)
      const refreshResult = await deps.oauth.refreshAccessToken(refreshToken)
      const tokenExpiresAt = new Date(now + refreshResult.expiresIn * 1000)
      const encryptedAccessToken = deps.encryption.encrypt(refreshResult.accessToken)

      // Re-prove the exact Redis owner immediately before the database CAS.
      // The connection generation is the durable fence if leadership moved.
      await assertLeadership()
      const updated = await deps.connectionRepo.updateTokens(
        orgId,
        connectionId,
        {
          lifecycleVersion: connection.lifecycleVersion,
          credentialGeneration: connection.credentialGeneration,
        },
        encryptedAccessToken,
        connection.encryptedRefreshToken,
        tokenExpiresAt,
      )
      if (!updated) {
        throw integrationError(
          'connection_disconnected',
          'Credential authority changed during token refresh',
        )
      }

      const updatedConnection = await deps.connectionRepo.findById(orgId, connectionId)
      if (!updatedConnection) {
        throw integrationError(
          'connection_not_found',
          'Connection not found after token refresh',
        )
      }
      return validateCurrentAuthority(updatedConnection)
    }

    if (!deps.coordination) return performRefresh(async () => undefined)
    const coordinated = await deps.coordination.run({
      organizationId: orgId,
      connectionId,
      expectedCredentialGeneration: connection.credentialGeneration,
      deadlineMs: now + REFRESH_COORDINATION_DEADLINE_MS,
      loadLatest: loadCommittedReplicaRefresh,
      refresh: performRefresh,
    })
    if (!coordinated.ok) {
      throw integrationError(
        'token_refresh_failed',
        `Google token refresh coordination denied (${coordinated.code})`,
      )
    }
    return coordinated.value
  }

export type RefreshGoogleToken = ReturnType<typeof refreshGoogleToken>
