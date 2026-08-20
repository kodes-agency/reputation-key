// Integration context — authorize, fence, revoke, atomically disconnect, and
// purge connection-owned source content.

import type { GoogleConnectionRepository } from '../ports/google-connection.repository'
import type { IntegrationCommandStore } from '../ports/integration-command-store.port'
import type { GoogleOAuthPort } from '../ports/google-oauth.port'
import type { TokenEncryptionPort } from '../ports/token-encryption.port'
import type { GoogleConnection } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { DisconnectGoogleInput } from '../dto/disconnect-google.dto'
export type { DisconnectGoogleInput as DisconnectGoogleAccountInput } from '../dto/disconnect-google.dto'
import type { SourceContentPurge } from '#/contexts/review/application/public-api'
import { canForContext } from '#/shared/domain/permissions'
import { googleConnectionId, type OrganizationId } from '#/shared/domain/ids'
import { integrationError } from '../../domain/errors'
import { integrationGoogleAccountDisconnected } from '../../domain/events'
import type { LoggerPort } from '#/shared/domain/logger.port'

export type DisconnectGoogleAccountDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
  oauth: GoogleOAuthPort
  encryption: TokenEncryptionPort
  commandStore: IntegrationCommandStore
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
  /**
   * BQC-1.7: bounded lifecycle purge of the connection's source content.
   * Optional until wired in composition (kept out of older test fixtures).
   */
  sourceContentPurge?: SourceContentPurge
  /** Fail-closed import lifecycle fence before provider or connection mutation. */
  cancelGoogleImportsForConnection?: (
    organizationId: OrganizationId,
    connectionId: string,
  ) => Promise<void>
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

    await deps.cancelGoogleImportsForConnection?.(ctx.organizationId, connectionId)

    // GBP Pub/Sub lifecycle: unsubscribe before the token is revoked (still valid).
    if (deps.unsubscribeFromNotifications) {
      try {
        await deps.unsubscribeFromNotifications(ctx.organizationId, input.connectionId)
      } catch (e) {
        deps.logger.warn(
          { err: e },
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
        { err: e },
        'Google token revocation failed — disconnecting locally anyway',
      )
    }

    // 4. Atomic disconnect: status, identifier/secret redaction, and the
    // durable disconnected fact commit in one transaction. Source-content
    // purge remains an idempotent cross-context cleanup after the commit.
    const updated = await deps.commandStore.disconnectGoogleAccount({
      organizationId: ctx.organizationId,
      connectionId,
      event: integrationGoogleAccountDisconnected({
        connectionId,
        organizationId: ctx.organizationId,
        occurredAt: deps.clock(),
      }),
    })

    // 5. Purge source content owned under this connection.
    if (deps.sourceContentPurge) {
      await deps.sourceContentPurge.forConnection(ctx.organizationId, input.connectionId)
    }

    return updated
  }

export type DisconnectGoogleAccount = ReturnType<typeof disconnectGoogleAccount>
