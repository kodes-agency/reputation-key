import type { Database } from '#/shared/db'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type {
  GoogleOAuthPort,
  GoogleOAuthProviderCallAuthorizer,
} from '../application/ports/google-oauth.port'
import type { OAuthStateHandleService } from '../application/oauth-state-handle'
import type { OAuthCallbackAbuseGate } from '../application/oauth-callback-abuse-gate'
import type {
  GoogleAuthorizedProviderExecutor,
  GoogleProviderTokenAccess,
} from '../application/ports/google-authorized-provider-executor.port'
import type { GoogleRefreshCoordination } from '../application/ports/google-refresh-coordination.port'
import type { GoogleDisconnectRevokeStore } from '../application/google-disconnect-revoke'
import { createActiveConnectionTokenProvider } from '../application/active-connection-token-provider'
import {
  connectGoogleAccount,
  disconnectGoogleAccount,
  getGoogleAuthUrl,
  listGoogleConnections,
  prepareGoogleConnectorDeparture,
  refreshGoogleToken,
} from '../application/use-cases'
import { createGoogleConnectionRepository } from '../infrastructure/repositories/google-connection.repository'
import { createGoogleOAuthExchangeRecoveryRepository } from '../infrastructure/repositories/google-oauth-exchange-recovery.repository'
import { createGoogleDisconnectRevokeRepository } from '../infrastructure/repositories/google-disconnect-revoke.repository'
import { createGoogleOAuthAdapter } from '../infrastructure/adapters/google-oauth.adapter'
import { createTokenEncryptionAdapter } from '../infrastructure/adapters/token-encryption.adapter'
import { createAtomicIntegrationCommandStore } from '../infrastructure/integration-command-store'
import { createGoogleConnectorDepartureStore } from '../infrastructure/google-connector-departure.store'

export type GoogleConnectionsRuntimeDeps = Readonly<{
  db: Database
  clock: () => Date
  idGen: () => string
  logger: LoggerPort
  config: Readonly<{
    nodeEnv: 'development' | 'production' | 'test'
    googleClientId: string
    googleClientSecret: string
    encryptionKey: string
    googleCallbackUrl: string
  }>
  oauthJwksUrl: string
  googleOAuth: GoogleOAuthPort | undefined
  googleAuthorizedProviderExecutor: GoogleAuthorizedProviderExecutor | undefined
  googleDisconnectRevokeStore: GoogleDisconnectRevokeStore | undefined
  authorizeGoogleOAuthProviderCall: GoogleOAuthProviderCallAuthorizer | undefined
  oauthStateHandles: OAuthStateHandleService | undefined
  oauthCallbackAbuseGate: OAuthCallbackAbuseGate | undefined
  googleRefreshCoordination: GoogleRefreshCoordination | undefined
}>

/** Late-bound neighbours: notifications and imports are built after this runtime. */
export type GoogleConnectionCommandHooks = Readonly<{
  unsubscribeFromNotifications: Parameters<
    typeof disconnectGoogleAccount
  >[0]['unsubscribeFromNotifications']
  cancelImportsForConnection:
    ((organizationId: string, connectionId: string) => Promise<unknown>) | undefined
}>

/** Connection storage, credentials, token refresh and the OAuth ingress gates. */
export function createGoogleConnectionsRuntime(deps: GoogleConnectionsRuntimeDeps) {
  const connectionRepo = createGoogleConnectionRepository(deps.db, deps.clock)
  const exchangeRecovery = createGoogleOAuthExchangeRecoveryRepository(deps.db)
  const disconnectRevokeStore =
    deps.googleDisconnectRevokeStore ?? createGoogleDisconnectRevokeRepository(deps.db)
  const commandStore = createAtomicIntegrationCommandStore(deps.db, deps.clock)
  const connectorDepartureStore = createGoogleConnectorDepartureStore(deps.db)

  const oauthPort =
    deps.googleOAuth ??
    createGoogleOAuthAdapter({
      clientId: deps.config.googleClientId,
      clientSecret: deps.config.googleClientSecret,
      jwksUrl: deps.oauthJwksUrl,
      clock: deps.clock,
      executor: deps.googleAuthorizedProviderExecutor,
      nowMs: () => deps.clock().getTime(),
    })
  // One key today. The version prefix exists so a second can be added here
  // without making the rows sealed by the first unreadable.
  const encryptionPort = createTokenEncryptionAdapter({
    activeVersion: 'v1',
    keys: { v1: deps.config.encryptionKey },
  })

  const refreshToken = refreshGoogleToken({
    connectionRepo,
    commandStore,
    oauth: oauthPort,
    encryption: encryptionPort,
    clock: deps.clock,
    authorizeProviderCall: deps.authorizeGoogleOAuthProviderCall,
    ...(deps.googleRefreshCoordination === undefined
      ? {}
      : { coordination: deps.googleRefreshCoordination }),
  })
  const tokenProvider = createActiveConnectionTokenProvider({
    connectionRepo,
    encryption: encryptionPort,
    clock: deps.clock,
    refreshGoogleToken: refreshToken,
  })
  const providerTokenAccess: GoogleProviderTokenAccess = {
    refreshAccessToken: ({ authorization }) =>
      tokenProvider.forceRefreshAccessToken(
        authorization.organizationId,
        authorization.connectionId,
        authorization.expectedCredentialGeneration,
      ),
    getAccessToken: ({ authorization }) =>
      tokenProvider.getAccessToken(
        authorization.organizationId,
        authorization.connectionId,
      ),
  }

  const callbackAbuseGate: OAuthCallbackAbuseGate =
    deps.oauthCallbackAbuseGate ??
    Object.freeze({
      admitPreState: async () =>
        deps.config.nodeEnv === 'production'
          ? ({ ok: false, code: 'quota_unavailable' } as const)
          : ({ ok: true } as const),
      admitResolvedTenant: async () =>
        deps.config.nodeEnv === 'production'
          ? ({ ok: false, code: 'quota_unavailable' } as const)
          : ({ ok: true } as const),
    })
  if (!deps.oauthStateHandles) {
    throw new Error('Opaque OAuth state service is required')
  }
  const oauthStateHandles = deps.oauthStateHandles
  const authorizationUrl = getGoogleAuthUrl({
    clientId: deps.config.googleClientId,
    callbackUrl: deps.config.googleCallbackUrl,
    clock: deps.clock,
    stateHandles: oauthStateHandles,
  })

  const commands = (hooks: GoogleConnectionCommandHooks) => {
    const connect = connectGoogleAccount({
      connectionRepo,
      oauth: oauthPort,
      encryption: encryptionPort,
      commandStore,
      exchangeRecovery,
      clock: deps.clock,
      idGen: deps.idGen,
      callbackUrl: deps.config.googleCallbackUrl,
      authorizeProviderCall: deps.authorizeGoogleOAuthProviderCall,
    })
    const cancelImports = hooks.cancelImportsForConnection
    return {
      connect,
      resume: connect.resume,
      disconnect: disconnectGoogleAccount({
        connectionRepo,
        oauth: oauthPort,
        encryption: encryptionPort,
        commandStore,
        clock: deps.clock,
        logger: deps.logger,
        authorizeProviderCall: deps.authorizeGoogleOAuthProviderCall,
        disconnectRevokeStore,
        idGen: deps.idGen,
        unsubscribeFromNotifications: hooks.unsubscribeFromNotifications,
        cancelGoogleImportsForConnection: cancelImports
          ? async (organizationId, connectionId) => {
              await cancelImports(organizationId, connectionId)
            }
          : undefined,
      }),
      list: listGoogleConnections({ connectionRepo }),
      prepareDeparture: prepareGoogleConnectorDeparture({
        store: connectorDepartureStore,
        cancelGoogleImportsForConnection: async (organizationId, connectionId) => {
          if (!cancelImports) throw new Error('Google import lifecycle unavailable')
          return cancelImports(organizationId, connectionId)
        },
        clock: deps.clock,
      }),
    }
  }

  return {
    connectionRepo,
    exchangeRecovery,
    disconnectRevokeStore,
    encryptionPort,
    oauthPort,
    refreshToken,
    tokenProvider,
    providerTokenAccess,
    oauth: {
      authorizationUrl,
      redeemState: oauthStateHandles.redeem,
      admitPreState: callbackAbuseGate.admitPreState,
      admitResolvedTenant: callbackAbuseGate.admitResolvedTenant,
    },
    commands,
  }
}
