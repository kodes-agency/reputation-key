import type { Database } from '#/shared/db'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type {
  GoogleOAuthPort,
  GoogleOAuthProviderCallAuthorizer,
} from './google-oauth.port.server'
import type { OAuthStateHandleService } from '../application/oauth-state-handle'
import type { OAuthCallbackAbuseGate } from './oauth-callback-abuse-gate.server'
import type {
  GoogleAuthorizedProviderExecutor,
  GoogleProviderTokenAccess,
} from '../provider/google-client.port.server'
import type { GoogleRefreshCoordination } from './google-refresh-coordination.port.server'
import type { GoogleDisconnectRevokeStore } from './google-disconnect-revoke.server'
import { createActiveConnectionTokenProvider } from './active-connection-token-provider.server'
import { connectGoogleAccount } from './connect-google-account.server'
import { disconnectGoogleAccount } from './disconnect-google-account.server'
import { getGoogleAuthUrl } from './get-google-auth-url.server'
import { listGoogleConnections } from './list-google-connections.server'
import { prepareGoogleConnectorDeparture } from './prepare-google-connector-departure.server'
import { refreshGoogleToken } from './refresh-google-token.server'
import { createGoogleConnectionRepository } from './google-connection-repository.server'
import { createGoogleOAuthExchangeRecoveryRepository } from './google-oauth-exchange-recovery-repository.server'
import { createGoogleDisconnectRevokeRepository } from './google-disconnect-revoke-repository.server'
import { createGoogleOAuthAdapter } from './google-oauth.adapter.server'
import { createTokenEncryptionAdapter } from './token-encryption.adapter.server'
import { createAtomicIntegrationCommandStore } from './integration-command-store.server'
import { createGoogleConnectorDepartureStore } from './google-connector-departure-store.server'

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
  oauthStateHandles: OAuthStateHandleService
  oauthCallbackAbuseGate: OAuthCallbackAbuseGate
  googleRefreshCoordination: GoogleRefreshCoordination | undefined
}>

/** Late-bound neighbours: notifications and imports are built after this runtime. */
export type GoogleConnectionCommandHooks = Readonly<{
  unsubscribeFromNotifications: Parameters<
    typeof disconnectGoogleAccount
  >[0]['unsubscribeFromNotifications']
  cancelImportsForConnection: (
    organizationId: string,
    connectionId: string,
  ) => Promise<unknown>
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

  const callbackAbuseGate = deps.oauthCallbackAbuseGate
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
        cancelGoogleImportsForConnection: hooks.cancelImportsForConnection,
      }),
      list: listGoogleConnections({ connectionRepo }),
      prepareDeparture: prepareGoogleConnectorDeparture({
        store: connectorDepartureStore,
        cancelGoogleImportsForConnection: hooks.cancelImportsForConnection,
        clock: deps.clock,
      }),
    }
  }

  return {
    connectionRepo,
    exchangeRecovery,
    disconnectRevokeStore,
    oauthPort,
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
