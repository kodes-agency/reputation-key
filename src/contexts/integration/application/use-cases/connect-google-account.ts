// Integration context — connect Google account use case
// Full 7-step pattern: authorize → validate → check uniqueness → build → persist → emit → return

import type { GoogleConnectionRepository } from '../ports/google-connection.repository'
import type { GoogleOAuthPort } from '../ports/google-oauth.port'
import type { TokenEncryptionPort } from '../ports/token-encryption.port'
import type { EventBus } from '#/shared/events/event-bus'
import type { GoogleConnection } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { ConnectGoogleInput } from '../dto/connect-google.dto'
import { can } from '#/shared/domain/permissions'
import { googleConnectionId } from '#/shared/domain/ids'
import { buildGoogleConnection } from '../../domain/constructors'
import { integrationError } from '../../domain/errors'
import { googleAccountConnected } from '../../domain/events'

export type ConnectGoogleAccountDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
  oauth: GoogleOAuthPort
  encryption: TokenEncryptionPort
  events: EventBus
  clock: () => Date
  callbackUrl: string
}>

export const connectGoogleAccount =
  (deps: ConnectGoogleAccountDeps) =>
  async (input: ConnectGoogleInput, ctx: AuthContext): Promise<GoogleConnection> => {
    // 1. Authorize
    if (!can(ctx.role, 'integration.manage')) {
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

    // 4. Check if connection already exists
    const existingConnection = await deps.connectionRepo.findByGoogleAccountId(
      ctx.organizationId,
      oauthResult.googleAccountId,
    )

    if (existingConnection) {
      // Reactivate, update tokens, and apply new visibility — single atomic write
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
      await deps.events.emit(
        googleAccountConnected({
          connectionId: updatedConnection.id,
          organizationId: ctx.organizationId,
          googleEmail: updatedConnection.googleEmail,
          occurredAt: now,
        }),
      )

      return updatedConnection
    }

    // 5. Build new connection
    const connectionId = googleConnectionId(crypto.randomUUID())

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

    // 6. Persist
    await deps.connectionRepo.insert(connection)

    // 7. Emit event
    await deps.events.emit(
      googleAccountConnected({
        connectionId: connection.id,
        organizationId: ctx.organizationId,
        googleEmail: connection.googleEmail,
        occurredAt: now,
      }),
    )

    return connection
  }

export type ConnectGoogleAccount = ReturnType<typeof connectGoogleAccount>
