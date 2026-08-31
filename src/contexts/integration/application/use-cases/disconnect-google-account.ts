// Integration context — authorize, fence, revoke, atomically disconnect, and
// purge connection-owned source content.

import type { GoogleConnectionRepository } from '../ports/google-connection.repository'
import type { IntegrationCommandStore } from '../ports/integration-command-store.port'
import type {
  GoogleOAuthPort,
  GoogleOAuthProviderCallAuthorizer,
} from '../ports/google-oauth.port'
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
import type { AssertDirectGoogleCredentialUse } from '../google-credential-execution-gate'
import {
  GOOGLE_DISCONNECT_REVOKE_WINDOW_MS,
  type GoogleDisconnectRevokeStore,
} from '../google-disconnect-revoke'

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
  assertDirectCredentialUse: AssertDirectGoogleCredentialUse
  authorizeProviderCall?: GoogleOAuthProviderCallAuthorizer
  disconnectRevokeStore?: GoogleDisconnectRevokeStore
  idGen?: () => string
}>

type GoogleRevokeOutcome = Awaited<
  ReturnType<NonNullable<GoogleOAuthPort['revokeTokenWithOutcome']>>
>

function revokeOutcomeCode(outcome: GoogleRevokeOutcome): string {
  if (outcome === 'confirmed_revoked') return 'google_revoke_confirmed'
  if (outcome === 'confirmed_not_sent') return 'provider_dispatch_not_started'
  return 'google_revoke_outcome_ambiguous'
}

export const disconnectGoogleAccount = (deps: DisconnectGoogleAccountDeps) => {
  /**
   * Wrong-home and expand-phase legacy rows may still be disconnected and
   * redacted locally, but no provider credential is decrypted or sent.
   */
  const admitProviderCredential = async (
    connection: GoogleConnection,
  ): Promise<boolean> => {
    try {
      await deps.assertDirectCredentialUse(connection)
      return true
    } catch {
      deps.logger.warn(
        { stage: 'credential-home' },
        'Google provider cleanup skipped outside the credential home',
      )
      return false
    }
  }

  /** GBP Pub/Sub lifecycle: unsubscribe before the token is revoked (still valid). */
  const unsubscribeFromNotifications = async (
    organizationId: OrganizationId,
    connectionId: string,
  ): Promise<void> => {
    if (!deps.unsubscribeFromNotifications) return
    try {
      await deps.unsubscribeFromNotifications(organizationId, connectionId)
    } catch (e) {
      deps.logger.warn(
        { err: e },
        'GBP notifications unsubscribe failed — disconnecting anyway',
      )
    }
  }

  /**
   * A revoke is never a best-effort direct side effect. The governed executor
   * first binds it to one durable cleanup attempt and one exact admission
   * permit; its result then commits with local redaction. If the process
   * disappears after provider dispatch, the elapsed-attempt reconciler finishes
   * locally without ever sending the token again.
   *
   * Null means no governed cleanup ran, so the caller still owes the local
   * disconnect.
   */
  const governedRevoke = async (
    connection: GoogleConnection,
    connectionId: ReturnType<typeof googleConnectionId>,
    ctx: AuthContext,
  ): Promise<GoogleConnection | null> => {
    if (
      !deps.authorizeProviderCall ||
      !deps.disconnectRevokeStore ||
      !deps.oauth.revokeTokenWithOutcome ||
      !deps.idGen
    ) {
      return null
    }
    const now = deps.clock()
    const attemptId = deps.idGen()
    const cleanupDeadlineAt = new Date(now.getTime() + GOOGLE_DISCONNECT_REVOKE_WINDOW_MS)
    let providerAuthorization
    try {
      providerAuthorization = await deps.authorizeProviderCall({
        operation: 'oauth.revoke',
        organizationId: ctx.organizationId,
        connectionId,
        initiatorUserId: ctx.userId,
        disconnectRevoke: { attemptId, cleanupDeadlineAt },
      })
    } catch {
      deps.logger.warn(
        { stage: 'revoke-authorization' },
        'Google cleanup authorization was unavailable; disconnecting locally',
      )
    }
    if (!providerAuthorization) return null

    const refreshToken = deps.encryption.decrypt(connection.encryptedRefreshToken)
    let outcome: GoogleRevokeOutcome
    try {
      outcome = await deps.oauth.revokeTokenWithOutcome(
        refreshToken,
        providerAuthorization,
      )
    } catch {
      outcome = 'cleanup_ambiguous'
    }
    const event = integrationGoogleAccountDisconnected({
      connectionId,
      organizationId: ctx.organizationId,
      occurredAt: deps.clock(),
    })
    const settled = await deps.disconnectRevokeStore.settle({
      attemptId,
      organizationId: ctx.organizationId,
      connectionId,
      initiatorUserId: ctx.userId,
      outcome,
      outcomeCode: revokeOutcomeCode(outcome),
      event,
      now: event.occurredAt,
    })
    if (!settled.ok) {
      throw integrationError(
        'oauth_failed',
        'Google disconnect cleanup will be completed by recovery',
      )
    }
    return settled.value
  }

  return async (
    input: DisconnectGoogleInput,
    ctx: AuthContext,
  ): Promise<GoogleConnection> => {
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

    const providerCredentialAdmitted = await admitProviderCredential(connection)
    if (providerCredentialAdmitted) {
      await unsubscribeFromNotifications(ctx.organizationId, input.connectionId)
    }

    // 3. Governed provider cleanup, when every governed dependency is present.
    const revoked = providerCredentialAdmitted
      ? await governedRevoke(connection, connectionId, ctx)
      : null

    // 4. No provider authority means no provider socket was opened. Local
    // disconnect remains safe and deterministic for wrong-home/legacy rows.
    // Atomic disconnect: status, identifier/secret redaction, and the
    // durable disconnected fact commit in one transaction. Source-content
    // purge remains an idempotent cross-context cleanup after the commit.
    const updated =
      revoked ??
      (await deps.commandStore.disconnectGoogleAccount({
        organizationId: ctx.organizationId,
        connectionId,
        event: integrationGoogleAccountDisconnected({
          connectionId,
          organizationId: ctx.organizationId,
          occurredAt: deps.clock(),
        }),
      }))

    // 5. Purge source content owned under this connection.
    if (deps.sourceContentPurge) {
      await deps.sourceContentPurge.forConnection(ctx.organizationId, input.connectionId)
    }

    return updated
  }
}

export type DisconnectGoogleAccount = ReturnType<typeof disconnectGoogleAccount>
