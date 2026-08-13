// Integration context — connect Google account use case
// Full 7-step pattern: authorize → validate → check uniqueness → build → persist → emit → return

import type { GoogleConnectionRepository } from '../ports/google-connection.repository'
import { isUniqueViolationError } from '../ports/google-connection.repository'
import type { IntegrationCommandStore } from '../ports/integration-command-store.port'
import type { GoogleOAuthPort } from '../ports/google-oauth.port'
import type { TokenEncryptionPort } from '../ports/token-encryption.port'
import type { GoogleConnection } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { ConnectGoogleInput } from '../dto/connect-google.dto'
export type { ConnectGoogleInput as ConnectGoogleAccountInput } from '../dto/connect-google.dto'
import { canForContext } from '#/shared/domain/permissions'
import { googleConnectionId } from '#/shared/domain/ids'
import { buildGoogleConnection } from '../../domain/constructors'
import { integrationError } from '../../domain/errors'
import { integrationGoogleAccountConnected } from '../../domain/events'

export type ConnectGoogleAccountDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
  oauth: GoogleOAuthPort
  encryption: TokenEncryptionPort
  commandStore: IntegrationCommandStore
  clock: () => Date
  idGen: () => string
  callbackUrl: string
}>

export const connectGoogleAccount = (deps: ConnectGoogleAccountDeps) => {
  const connect = async (
    input: ConnectGoogleInput,
    ctx: AuthContext,
  ): Promise<GoogleConnection> => {
    // 1. Authorize
    if (!canForContext(ctx, 'integration.manage')) {
      throw integrationError(
        'forbidden',
        'You do not have permission to manage integrations',
      )
    }

    // 2. Opaque state redemption has already consumed and bound the PKCE/OIDC
    // verifier material to this tenant, user, and session.
    const verifierMaterial = input.verifierMaterial
    const oauthResult = await deps.oauth.exchangeCode({
      contractVersion: 'v2',
      code: input.code,
      redirectUri: deps.callbackUrl,
      codeVerifier: verifierMaterial.codeVerifier,
      oidcNonce: verifierMaterial.oidcNonce,
    })
    if (oauthResult.identity.kind !== 'oidc') {
      throw integrationError('oauth_failed', 'Google OAuth identity contract mismatch')
    }
    const now = deps.clock()
    const tokenExpiresAt = new Date(now.getTime() + oauthResult.expiresIn * 1000)

    // 4. Encrypt tokens
    const encryptedAccessToken = deps.encryption.encrypt(oauthResult.accessToken)
    const encryptedRefreshToken = deps.encryption.encrypt(oauthResult.refreshToken)

    // 5. Signed OIDC subjects enforce one provider identity per organization.
    const identityLookup = {
      googleSubject: oauthResult.identity.googleSubject,
    }
    const existingConnection =
      await deps.connectionRepo.findByGoogleIdentityGlobal(identityLookup)

    if (existingConnection) {
      if (existingConnection.organizationId !== ctx.organizationId) {
        // Account is claimed by another org — hard reject; the user must disconnect
        // it there first. Global uniqueness makes this a hard boundary.
        throw integrationError(
          'account_already_connected',
          'This Google account is already connected in another organization',
        )
      }
      // Same org → reactivate, update tokens, apply new visibility (+ fact,
      // atomic via the command store).
      const updatedConnection = await deps.commandStore.reconnectGoogleAccount({
        organizationId: ctx.organizationId,
        connectionId: existingConnection.id,
        encryptedAccessToken,
        encryptedRefreshToken,
        tokenExpiresAt,
        visibility: input.visibility,
        event: integrationGoogleAccountConnected({
          connectionId: existingConnection.id,
          organizationId: ctx.organizationId,
          connectedBy: ctx.userId,
          occurredAt: now,
        }),
      })

      return updatedConnection
    }

    // 6. Build new connection
    const connectionId = googleConnectionId(deps.idGen())

    const buildResult = buildGoogleConnection({
      id: connectionId,
      organizationId: ctx.organizationId,
      identity: oauthResult.identity,
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

    // 7. Persist + fact — atomic via the command store. The global unique
    //    index still backstops a raced insert between our check and this write.
    try {
      await deps.commandStore.connectGoogleAccount({
        connection,
        event: integrationGoogleAccountConnected({
          connectionId: connection.id,
          organizationId: ctx.organizationId,
          connectedBy: ctx.userId,
          occurredAt: now,
        }),
      })
    } catch (err) {
      if (!isUniqueViolationError(err)) throw err

      // Concurrent insert raced past the check — fetch globally and decide by org.
      const concurrentConnection =
        await deps.connectionRepo.findByGoogleIdentityGlobal(identityLookup)
      if (!concurrentConnection) throw err
      if (concurrentConnection.organizationId !== ctx.organizationId) {
        throw integrationError(
          'account_already_connected',
          'This Google account is already connected in another organization',
        )
      }

      return concurrentConnection
    }

    return connection
  }

  return connect
}

export type ConnectGoogleAccount = ReturnType<typeof connectGoogleAccount>
