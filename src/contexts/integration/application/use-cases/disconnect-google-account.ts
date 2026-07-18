// Integration context — disconnect Google account use case
// Steps: authorize → find connection → unsubscribe/revoke → atomic disconnect
// (status + redaction + fact) → purge cache → purge source content (BQC-1.7)

import type { GoogleConnectionRepository } from '../ports/google-connection.repository'
import type { IntegrationCommandStore } from '../ports/integration-command-store.port'
import type { GoogleOAuthPort } from '../ports/google-oauth.port'
import type { TokenEncryptionPort } from '../ports/token-encryption.port'
import type { GbpCacheRepository } from '../ports/gbp-cache.repository'
import type { GoogleConnection } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { DisconnectGoogleInput } from '../dto/disconnect-google.dto'
export type { DisconnectGoogleInput as DisconnectGoogleAccountInput } from '../dto/disconnect-google.dto'
import type { SourceContentPurge } from '#/contexts/review/application/ports/source-content-purge.port'
import { canForContext } from '#/shared/domain/permissions'
import { googleConnectionId, type OrganizationId } from '#/shared/domain/ids'
import { integrationError } from '../../domain/errors'
import { integrationGoogleAccountDisconnected } from '../../domain/events'
import type { LoggerPort } from '#/shared/domain/logger.port'

export type DisconnectGoogleAccountDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
  oauth: GoogleOAuthPort
  encryption: TokenEncryptionPort
  cacheRepo: GbpCacheRepository
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

    // 4. Atomic disconnect: status → disconnected + identifier/secret redaction
    //    + the durable disconnected fact in ONE transaction (BQC-3.5). The
    //    cache purge (step 5) and the source-content retention purge (step 6)
    //    stay OUTSIDE the transaction: they are idempotent cross-system
    //    cleanup, and the committed status + redaction + fact are the
    //    recovery record for them. (The review-side purge command remains a
    //    noted gap for later.)
    const updated = await deps.commandStore.disconnectGoogleAccount({
      organizationId: ctx.organizationId,
      connectionId,
      event: integrationGoogleAccountDisconnected({
        connectionId,
        organizationId: ctx.organizationId,
        occurredAt: deps.clock(),
      }),
    })

    // 5. Purge cache
    await deps.cacheRepo.deleteByConnectionId(connectionId, ctx.organizationId)

    // 6. BQC-1.7: bounded lifecycle purge of source content for this
    // connection — reviews (and replies via per-batch FK cascade), with
    // content-free evidence. Without a valid grant, refresh is impossible;
    // keeping the content would be an unmanaged copy (ADR 0031).
    if (deps.sourceContentPurge) {
      await deps.sourceContentPurge.forConnection(ctx.organizationId, input.connectionId)
    }

    return updated
  }

export type DisconnectGoogleAccount = ReturnType<typeof disconnectGoogleAccount>
