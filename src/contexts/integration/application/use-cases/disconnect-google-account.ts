// Integration context — disconnect Google account use case
// Steps: authorize → find connection → revoke token → mark disconnected → purge cache → emit

import type { GoogleConnectionRepository } from '../ports/google-connection.repository'
import type { GoogleOAuthPort } from '../ports/google-oauth.port'
import type { TokenEncryptionPort } from '../ports/token-encryption.port'
import type { GbpCacheRepository } from '../ports/gbp-cache.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type { GoogleConnection } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { DisconnectGoogleInput } from '../dto/disconnect-google.dto'
import { can } from '#/shared/domain/permissions'
import { googleConnectionId } from '#/shared/domain/ids'
import { integrationError } from '../../domain/errors'
import { googleAccountDisconnected } from '../../domain/events'
import type { Logger } from 'pino'

export type DisconnectGoogleAccountDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
  oauth: GoogleOAuthPort
  encryption: TokenEncryptionPort
  cacheRepo: GbpCacheRepository
  events: EventBus
  clock: () => Date
  logger: Logger
}>

export const disconnectGoogleAccount =
  (deps: DisconnectGoogleAccountDeps) =>
  async (input: DisconnectGoogleInput, ctx: AuthContext): Promise<GoogleConnection> => {
    // 1. Authorize
    if (!can(ctx.role, 'integration.manage')) {
      throw integrationError(
        'forbidden',
        'You do not have permission to manage integrations',
      )
    }

    const connectionId = googleConnectionId(input.connectionId)

    // 2. Find connection
    const connection = await deps.connectionRepo.findById(
      ctx.organizationId,
      connectionId,
    )
    if (!connection) {
      throw integrationError('connection_not_found', 'Google connection not found')
    }

    if (connection.status === 'disconnected') {
      return connection
    }

    // 3. Revoke token with Google (best-effort)
    try {
      const refreshToken = deps.encryption.decrypt(connection.encryptedRefreshToken)
      await deps.oauth.revokeToken(refreshToken)
    } catch (e) {
      deps.logger.warn(
        { connectionId: input.connectionId, err: e },
        'Google token revocation failed — disconnecting locally anyway',
      )
    }

    // 4. Mark status as disconnected
    await deps.connectionRepo.updateStatus(
      ctx.organizationId,
      connectionId,
      'disconnected',
    )

    // 5. Purge cache
    await deps.cacheRepo.deleteByConnectionId(connectionId, ctx.organizationId)

    // 6. Emit event
    await deps.events.emit(
      googleAccountDisconnected({
        connectionId,
        organizationId: ctx.organizationId,
        occurredAt: deps.clock(),
      }),
    )

    const updated = await deps.connectionRepo.findById(ctx.organizationId, connectionId)
    if (!updated) {
      throw integrationError(
        'connection_not_found',
        'Connection not found after disconnect',
      )
    }

    return updated
  }

export type DisconnectGoogleAccount = ReturnType<typeof disconnectGoogleAccount>
