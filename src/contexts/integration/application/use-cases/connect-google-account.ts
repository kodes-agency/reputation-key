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
import type { GoogleConnectionId } from '../../domain/types'
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

    // 2. Freeze an exact targeted row before any provider call. A targeted
    // ceremony cannot be redirected to another row by the returned subject.
    const targetConnection =
      input.connectionMode === 'new'
        ? null
        : await deps.connectionRepo.findById(
            ctx.organizationId,
            input.targetConnectionId as GoogleConnectionId,
          )
    if (input.connectionMode !== 'new' && !targetConnection) {
      throw integrationError('connection_not_found', 'Google connection not found')
    }

    // 3. Opaque state redemption has already consumed and bound the PKCE/OIDC
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

    // 5. Signed OIDC subjects enforce one provider identity per organization.
    const identityLookup = {
      googleSubject: oauthResult.identity.googleSubject,
    }
    const existingConnection =
      await deps.connectionRepo.findByGoogleIdentityGlobal(identityLookup)

    if (input.connectionMode === 'new') {
      if (existingConnection) {
        throw integrationError(
          'account_already_connected',
          'This Google account is already connected',
        )
      }
    } else {
      if (
        !targetConnection ||
        (targetConnection.googleSubject !== null &&
          targetConnection.googleSubject !== oauthResult.identity.googleSubject) ||
        (existingConnection !== null && existingConnection.id !== targetConnection.id)
      ) {
        throw integrationError(
          'account_already_connected',
          'This Google account does not match the requested connection',
        )
      }
      const encryptedAccessToken = deps.encryption.encrypt(oauthResult.accessToken)
      const encryptedRefreshToken = deps.encryption.encrypt(oauthResult.refreshToken)
      try {
        return await deps.commandStore.reconnectGoogleAccount({
          organizationId: ctx.organizationId,
          connectionId: targetConnection.id,
          googleSubject: oauthResult.identity.googleSubject,
          encryptedAccessToken,
          encryptedRefreshToken,
          tokenExpiresAt,
          scopes: oauthResult.scopes,
          visibility: input.visibility,
          event: integrationGoogleAccountConnected({
            connectionId: targetConnection.id,
            organizationId: ctx.organizationId,
            connectedBy: ctx.userId,
            occurredAt: now,
          }),
        })
      } catch (error) {
        if (!isUniqueViolationError(error)) throw error
        throw integrationError(
          'account_already_connected',
          'This Google account is already connected',
        )
      }
    }

    // Encrypt only after the server-authoritative mode/target/identity checks.
    const encryptedAccessToken = deps.encryption.encrypt(oauthResult.accessToken)
    const encryptedRefreshToken = deps.encryption.encrypt(oauthResult.refreshToken)

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

    // Persist + fact atomically. The global unique index backstops a raced
    // first connection between the global lookup and this write.
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

      // A raced `new` ceremony never adopts or mutates the winning row.
      throw integrationError(
        'account_already_connected',
        'This Google account is already connected',
      )
    }

    return connection
  }

  return connect
}

export type ConnectGoogleAccount = ReturnType<typeof connectGoogleAccount>
