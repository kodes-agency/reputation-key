// Integration context — connect Google account use case
// Full 7-step pattern: authorize → validate → check uniqueness → build → persist → emit → return

import type { GoogleConnectionRepository } from '../ports/google-connection.repository'
import { isUniqueViolationError } from '../ports/google-connection.repository'
import type { GoogleOAuthPort } from '../ports/google-oauth.port'
import type { TokenEncryptionPort } from '../ports/token-encryption.port'
import type { EventBus } from '#/shared/events/event-bus'
import type { GoogleConnection } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { ConnectGoogleInput } from '../dto/connect-google.dto'
export type { ConnectGoogleInput as ConnectGoogleAccountInput } from '../dto/connect-google.dto'
import { canForContext } from '#/shared/domain/permissions'
import { googleConnectionId } from '#/shared/domain/ids'
import { buildGoogleConnection } from '../../domain/constructors'
import { integrationError } from '../../domain/errors'
import { integrationGoogleAccountConnected } from '../../domain/events'
import { emitAndRecord, type OutboxRepository } from '#/shared/outbox'

export type ConnectGoogleAccountDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
  oauth: GoogleOAuthPort
  encryption: TokenEncryptionPort
  events: EventBus
  clock: () => Date
  idGen: () => string
  callbackUrl: string
  outboxRepo?: OutboxRepository
}>

export const connectGoogleAccount =
  (deps: ConnectGoogleAccountDeps) =>
  async (input: ConnectGoogleInput, ctx: AuthContext): Promise<GoogleConnection> => {
    // 1. Authorize
    if (!canForContext(ctx, 'integration.manage')) {
      throw integrationError(
        'forbidden',
        'You do not have permission to manage integrations',
      )
    }

    // 2. Exchange OAuth code
    const oauthResult = await deps.oauth.exchangeCode(input.code, deps.callbackUrl)
    const now = deps.clock()
    const tokenExpiresAt = new Date(now.getTime() + oauthResult.expiresIn * 1000)

    // 3. Encrypt tokens
    const encryptedAccessToken = deps.encryption.encrypt(oauthResult.accessToken)
    const encryptedRefreshToken = deps.encryption.encrypt(oauthResult.refreshToken)

    // 4. Check if connection already exists (GLOBAL — one Google account belongs
    //    to exactly one org per the global-uniqueness invariant).
    const existingConnection = await deps.connectionRepo.findByGoogleAccountIdGlobal(
      oauthResult.googleAccountId,
    )

    if (existingConnection) {
      if (existingConnection.organizationId !== ctx.organizationId) {
        // Account is claimed by another org — hard reject; the user must disconnect
        // it there first. Global uniqueness makes this a hard boundary.
        throw integrationError(
          'account_already_connected',
          'This Google account is already connected in another organization',
        )
      }
      // Same org → reactivate, update tokens, apply new visibility (atomic write).
      await deps.connectionRepo.updateReconnection(
        ctx.organizationId,
        existingConnection.id,
        encryptedAccessToken,
        encryptedRefreshToken,
        tokenExpiresAt,
        input.visibility,
      )

      const updatedConnection = await deps.connectionRepo.findById(
        ctx.organizationId,
        existingConnection.id,
      )
      if (!updatedConnection) {
        throw integrationError(
          'connection_not_found',
          'Connection not found after update',
        )
      }

      // Emit event for reconnection
      await emitAndRecord(
        deps.events,
        deps.outboxRepo,
        integrationGoogleAccountConnected({
          connectionId: updatedConnection.id,
          organizationId: ctx.organizationId,
          googleEmail: updatedConnection.googleEmail,
          occurredAt: now,
        }),
      )

      return updatedConnection
    }

    // 5. Build new connection
    const connectionId = googleConnectionId(deps.idGen())

    const buildResult = buildGoogleConnection({
      id: connectionId,
      organizationId: ctx.organizationId,
      googleAccountId: oauthResult.googleAccountId,
      googleEmail: oauthResult.googleEmail,
      encryptedAccessToken,
      encryptedRefreshToken,
      tokenExpiresAt,
      scopes: oauthResult.scopes,
      connectedBy: ctx.userId,
      visibility: input.visibility,
      now,
    })

    if (buildResult.isErr()) {
      throw buildResult.error
    }

    const connection = buildResult.value

    // 6. Persist — handle race condition where another request inserted
    // the same connection between our check and this insert.
    try {
      await deps.connectionRepo.insert(connection)
    } catch (err) {
      if (!isUniqueViolationError(err)) throw err

      // Concurrent insert raced past the check — fetch globally and decide by org.
      const concurrentConnection = await deps.connectionRepo.findByGoogleAccountIdGlobal(
        oauthResult.googleAccountId,
      )
      if (!concurrentConnection) throw err
      if (concurrentConnection.organizationId !== ctx.organizationId) {
        throw integrationError(
          'account_already_connected',
          'This Google account is already connected in another organization',
        )
      }

      return concurrentConnection
    }

    // 7. Emit event
    await emitAndRecord(
      deps.events,
      deps.outboxRepo,
      integrationGoogleAccountConnected({
        connectionId: connection.id,
        organizationId: ctx.organizationId,
        googleEmail: connection.googleEmail,
        occurredAt: now,
      }),
    )

    return connection
  }

export type ConnectGoogleAccount = ReturnType<typeof connectGoogleAccount>
