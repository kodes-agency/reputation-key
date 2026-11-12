import type { Database } from '#/shared/db'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type {
  PropertyGoogleBindingPublicApi,
  PropertyPublicApi,
} from '#/contexts/property/application/public-api'
import type {
  GoogleAuthorizedProviderExecutor,
  GoogleProviderReauthorize,
  GoogleProviderTokenAccess,
  GoogleRefreshingProviderExecutorFactory,
} from '../application/ports/google-authorized-provider-executor.port'
import type { ActiveConnectionTokenProviderDeps } from '../application/active-connection-token-provider'
import { parseGbpNotificationSubscriptionConfig } from '../application/notification-subscription-config'
import { createMyBusinessNotificationsAdapter } from '../infrastructure/adapters/mybusiness-notifications.adapter'
import { createGoogleNotificationRuntime } from '../infrastructure/google-notification-runtime'

type NotificationAuthority = Readonly<{
  authorizeProviderCall: Parameters<
    typeof createGoogleNotificationRuntime
  >[0]['authorizeProviderCall']
  reauthorize: GoogleProviderReauthorize
}>

export type GoogleNotificationsRuntimeDeps = Readonly<{
  db: Database
  clock: () => Date
  logger: LoggerPort
  connectionRepo: ActiveConnectionTokenProviderDeps['connectionRepo']
  propertyApi: PropertyPublicApi
  propertyBindingApi: PropertyGoogleBindingPublicApi | undefined
  executor: GoogleAuthorizedProviderExecutor | undefined
  providerTokenAccess: GoogleProviderTokenAccess
  withSingle401Refresh: GoogleRefreshingProviderExecutorFactory
  pubsubTopic: string
  pubsubNotificationTypes: string
  /** The review-sync runtime owns the authority and is built after this one. */
  authority: () => NotificationAuthority | undefined
}>

/** GBP push subscription management, backfill and the daily reconciliation. */
export function createGoogleNotificationsRuntime(deps: GoogleNotificationsRuntimeDeps) {
  const executor = deps.executor
    ? deps.withSingle401Refresh({
        executor: deps.executor,
        ...deps.providerTokenAccess,
        reauthorize: async (input) => {
          const authority = deps.authority()
          if (!authority) {
            throw new Error('Google notification reauthorization is unavailable')
          }
          return authority.reauthorize(input)
        },
      })
    : undefined
  const notifications = executor
    ? createMyBusinessNotificationsAdapter({
        executor,
        nowMs: () => deps.clock().getTime(),
      })
    : Object.freeze({
        subscribe: async () => {
          throw new Error('Governed Google notification subscription is unavailable')
        },
        unsubscribe: async () => {
          throw new Error('Governed Google notification subscription is unavailable')
        },
      })
  const config = parseGbpNotificationSubscriptionConfig(
    deps.pubsubTopic,
    deps.pubsubNotificationTypes,
  )
  return createGoogleNotificationRuntime({
    db: deps.db,
    clock: deps.clock,
    connectionRepo: deps.connectionRepo,
    propertyApi: deps.propertyApi,
    propertyBindingApi: deps.propertyBindingApi,
    authorizeProviderCall: async (organizationId, connectionId, accountId) => {
      const authority = deps.authority()
      return authority
        ? authority.authorizeProviderCall(organizationId, connectionId, accountId)
        : { ok: false, code: 'authorization_unavailable' }
    },
    notifications,
    pubsubTopic: config.pubsubTopic,
    notificationTypes: config.notificationTypes,
    logger: deps.logger,
  })
}
