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

export type RefreshGoogleTokenDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
  oauth: GoogleOAuthPort
  encryption: TokenEncryptionPort
  clock: () => Date
}>

export const refreshGoogleToken =
  (deps: RefreshGoogleTokenDeps) =>
  async (orgId: OrganizationId, connectionIdStr: string): Promise<GoogleConnection> => {
    const connectionId = googleConnectionId(connectionIdStr)

    // 1. Find connection
    const connection = await deps.connectionRepo.findById(orgId, connectionId)
    if (!connection) {
      throw integrationError('connection_not_found', 'Google connection not found')
    }

    // 2. Check status
    if (connection.status === 'disconnected') {
      throw integrationError(
        'connection_disconnected',
        'Cannot refresh token for disconnected connection',
      )
    }

    // 3. Check if token needs refresh (5 min buffer)
    const now = deps.clock().getTime()
    const expiresAt = connection.tokenExpiresAt.getTime()

    if (expiresAt > now + TOKEN_EXPIRY_BUFFER_MS) {
      // Token is still valid, return as-is
      return connection
    }

    // 4. Decrypt refresh token
    const refreshToken = deps.encryption.decrypt(connection.encryptedRefreshToken)

    // 5. Refresh access token
    const refreshResult = await deps.oauth.refreshAccessToken(refreshToken)
    const tokenExpiresAt = new Date(now + refreshResult.expiresIn * 1000)

    // 6. Encrypt new access token
    const encryptedAccessToken = deps.encryption.encrypt(refreshResult.accessToken)

    // 7. Update tokens
    await deps.connectionRepo.updateTokens(
      orgId,
      connectionId,
      encryptedAccessToken,
      connection.encryptedRefreshToken, // Keep same refresh token
      tokenExpiresAt,
    )

    // 8. Return refreshed connection
    const updatedConnection = await deps.connectionRepo.findById(orgId, connectionId)
    if (!updatedConnection) {
      throw integrationError(
        'connection_not_found',
        'Connection not found after token refresh',
      )
    }

    return updatedConnection
  }

export type RefreshGoogleToken = ReturnType<typeof refreshGoogleToken>
