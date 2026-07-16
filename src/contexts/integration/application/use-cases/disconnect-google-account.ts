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
export type { DisconnectGoogleInput as DisconnectGoogleAccountInput } from '../dto/disconnect-google.dto'
import { canForContext } from '#/shared/domain/permissions'
import { googleConnectionId, type OrganizationId } from '#/shared/domain/ids'
import { integrationError } from '../../domain/errors'
import { integrationGoogleAccountDisconnected } from '../../domain/events'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { emitAndRecord, type OutboxRepository } from '#/shared/outbox'

export type DisconnectGoogleAccountDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
  oauth: GoogleOAuthPort
  encryption: TokenEncryptionPort
  cacheRepo: GbpCacheRepository
  events: EventBus
  clock: () => Date
  logger: LoggerPort
  /**
   * Best-effort hook to unsubscribe from GBP notifications before the token is
   * revoked (Pub/Sub lifecycle step 3 — token is still valid at this point).
   */
  unsubscribeFromNotifications?: (
    organizationId: OrganizationId,
    connectionId: string,
  ) => Promise<void>
  outboxRepo?: OutboxRepository
}>

export const disconnectGoogleAccount =
  (deps: DisconnectGoogleAccountDeps) =>
  async (input: DisconnectGoogleInput, ctx: AuthContext): Promise<GoogleConnection> => {
    // 1. Authorize
    if (!canForContext(ctx, 'integration.manage')) {
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

    // GBP Pub/Sub lifecycle: unsubscribe before the token is revoked (still valid).
    if (deps.unsubscribeFromNotifications) {
      try {
        await deps.unsubscribeFromNotifications(ctx.organizationId, input.connectionId)
      } catch (e) {
        deps.logger.warn(
          { connectionId: input.connectionId, err: e },
          'GBP notifications unsubscribe failed — disconnecting anyway',
        )
      }
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
    await emitAndRecord(
      deps.events,
      deps.outboxRepo,
      integrationGoogleAccountDisconnected({
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
