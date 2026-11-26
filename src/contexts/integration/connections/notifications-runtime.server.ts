import type { Database } from '#/shared/db'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type {
  PropertyGoogleBindingPublicApi,
  PropertyPublicApi,
} from '#/contexts/property/public-api'
import type {
  GoogleAuthorizedProviderExecutor,
  GoogleProviderReauthorize,
  GoogleProviderTokenAccess,
} from '../provider/google-client.port.server'
import { createSingle401RefreshExecutor } from '../provider/google-client.server'
import type { ActiveConnectionTokenProviderDeps } from './active-connection-token-provider.server'
import { parseGbpNotificationSubscriptionConfig } from './notification-subscription-config.server'
import { createMyBusinessNotificationsAdapter } from './mybusiness-notifications.adapter.server'
import { createGoogleNotificationAccountCandidates } from './google-notification-account-candidates.server'
import { createGoogleNotificationAccountUsageReader } from './google-notification-account-usage.server'
import { createGbpSubscribeBackfill } from '../application/use-cases/gbp-subscribe-backfill'
import { createGbpNotificationReconciliation } from './reconcile-gbp-notification-subscriptions.server'
import {
  manageNotifications,
  type ManageNotificationsDeps,
} from './manage-notifications.server'
import { createGoogleNotificationAccounts } from './google-notification-accounts.server'

type NotificationAuthority = Readonly<{
  authorizeProviderCall: ManageNotificationsDeps['authorizeProviderCall']
  reauthorize: GoogleProviderReauthorize
}>

export type GoogleNotificationsRuntimeDeps = Readonly<{
  db: Database
  clock: () => Date
  logger: LoggerPort
  connectionRepo: ActiveConnectionTokenProviderDeps['connectionRepo']
  propertyApi: Pick<PropertyPublicApi, 'findIdsByGoogleConnection'>
  propertyBindingApi: Pick<PropertyGoogleBindingPublicApi, 'readInternal'>
  executor: GoogleAuthorizedProviderExecutor | undefined
  providerTokenAccess: GoogleProviderTokenAccess
  pubsubTopic: string
  pubsubNotificationTypes: string
  /** Present only when review-sync content authority exists. */
  authority: NotificationAuthority | undefined
}>

const unavailable = async (): Promise<never> => {
  throw new Error('Governed Google notification subscription is unavailable')
}

/**
 * GBP push subscription management, backfill and the daily reconciliation.
 * Import, disconnect and reconciliation share one account coordinator.
 */
export function createGoogleNotificationsRuntime(deps: GoogleNotificationsRuntimeDeps) {
  const { authority } = deps
  const executor = deps.executor
    ? createSingle401RefreshExecutor({
        executor: deps.executor,
        ...deps.providerTokenAccess,
        reauthorize: async (input) => {
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
    : Object.freeze({ subscribe: unavailable, unsubscribe: unavailable })
  const config = parseGbpNotificationSubscriptionConfig(
    deps.pubsubTopic,
    deps.pubsubNotificationTypes,
  )
  const accounts = createGoogleNotificationAccounts(deps.db, deps.clock)
  const reads: Parameters<typeof createGoogleNotificationAccountCandidates>[0] = {
    listOrganizations: deps.connectionRepo.listOrganizationIdsWithActiveConnections,
    listConnections: (organization) =>
      deps.connectionRepo.listByOrganization(organization),
    findLinkedPropertyIds: deps.propertyApi.findIdsByGoogleConnection,
    readBinding: deps.propertyBindingApi.readInternal,
    accounts,
  }
  const management = manageNotifications({
    accounts,
    nowMs: () => deps.clock().getTime(),
    hasOtherActiveAccountBinding: createGoogleNotificationAccountUsageReader(reads),
    authorizeProviderCall: async (organizationId, connectionId, accountId) =>
      authority
        ? authority.authorizeProviderCall(organizationId, connectionId, accountId)
        : { ok: false, code: 'authorization_unavailable' },
    notifications,
    pubsubTopic: config.pubsubTopic,
    notificationTypes: config.notificationTypes,
    logger: deps.logger,
  })
  // Both callers have already authorized the Organization: the operator
  // harness for its report, and current policy for the daily worker repair.
  const backfill = createGbpSubscribeBackfill({
    listConnections: reads.listConnections,
    subscribe: management.subscribe,
  })
  const reconcile = createGbpNotificationReconciliation({
    topicConfigured: config.pubsubTopic.length > 0,
    listAccounts: createGoogleNotificationAccountCandidates(reads),
    recordAttempt: accounts.attempted,
    backfill,
    nowMs: () => deps.clock().getTime(),
  })
  return { management, backfill, reconcile }
}
