import type { Database } from '#/shared/db'
import type { Clock } from '#/shared/domain/clock'
import type {
  PropertyGoogleBindingPublicApi,
  PropertyPublicApi,
} from '#/contexts/property/application/public-api'
import type { GoogleConnectionRepository } from '../application/ports/google-connection.repository'
import { createGoogleNotificationAccountCandidates } from '../application/google-notification-account-candidates'
import { createGoogleNotificationAccountUsageReader } from '../application/google-notification-account-usage'
import { createGbpSubscribeBackfill } from '../application/use-cases/gbp-subscribe-backfill'
import { createGbpNotificationReconciliation } from '../application/use-cases/reconcile-gbp-notification-subscriptions'
import {
  manageNotifications,
  type ManageNotificationsDeps,
} from '../application/use-cases/manage-notifications'
import { createGoogleNotificationAccounts } from './google-notification-accounts'

/** Import, disconnect and reconciliation share one account coordinator. */
export function createGoogleNotificationRuntime(
  deps: Readonly<{
    db: Database
    clock: Clock
    connectionRepo: GoogleConnectionRepository
    propertyApi: Pick<PropertyPublicApi, 'findIdsByGoogleConnection'>
    propertyBindingApi?: Pick<PropertyGoogleBindingPublicApi, 'readInternal'>
  }> &
    Pick<
      ManageNotificationsDeps,
      | 'authorizeProviderCall'
      | 'notifications'
      | 'pubsubTopic'
      | 'notificationTypes'
      | 'logger'
    >,
) {
  const accounts = createGoogleNotificationAccounts(deps.db, deps.clock)
  const reads: Parameters<typeof createGoogleNotificationAccountCandidates>[0] = {
    listOrganizations: deps.connectionRepo.listOrganizationIdsWithActiveConnections,
    listConnections: (organization) =>
      deps.connectionRepo.listByOrganization(organization, { showAll: true }),
    findLinkedPropertyIds: deps.propertyApi.findIdsByGoogleConnection,
    readBinding:
      deps.propertyBindingApi?.readInternal ??
      (async () => {
        throw new Error('Property binding reader unavailable')
      }),
    accounts,
  }
  const management = manageNotifications({
    accounts,
    nowMs: () => deps.clock().getTime(),
    hasOtherActiveAccountBinding: createGoogleNotificationAccountUsageReader(reads),
    authorizeProviderCall: deps.authorizeProviderCall,
    notifications: deps.notifications,
    pubsubTopic: deps.pubsubTopic,
    notificationTypes: deps.notificationTypes,
    logger: deps.logger,
  })
  // Both callers have already authorized the Organization: the operator
  // harness for its report, and current policy for the daily worker repair.
  const backfill = createGbpSubscribeBackfill({
    listConnections: reads.listConnections,
    subscribe: management.subscribe,
  })
  const reconcile = createGbpNotificationReconciliation({
    topicConfigured: deps.pubsubTopic.length > 0,
    listAccounts: createGoogleNotificationAccountCandidates(reads),
    recordAttempt: accounts.attempted,
    backfill,
    nowMs: () => deps.clock().getTime(),
  })
  return { management, backfill, reconcile }
}
