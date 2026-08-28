// Integration context — govern the GBP Pub/Sub notification desired state.
//
// This use case deliberately receives an already-governed provider
// authorization instead of reading/decrypting connection credentials itself.
// Each exact account comes from an active Property binding; notification-
// setting reads/writes carry that Property's frozen authorization vector.

import type { GoogleProviderCallAuthorization } from '../google-provider-contract'
import type {
  GbpNotificationType,
  MyBusinessNotificationsPort,
} from '../ports/mybusiness-notifications.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { OrganizationId } from '#/shared/domain/ids'

export type NotificationProviderAuthorizationResult =
  | Readonly<{
      ok: true
      targets: ReadonlyArray<
        Readonly<{
          accessToken: string
          authorization: GoogleProviderCallAuthorization
          /** Exact account from the authorized active Property binding. */
          gbpAccountId: string
        }>
      >
    }>
  | Readonly<{
      ok: false
      code:
        | 'connection_missing'
        | 'connection_inactive'
        | 'token_unavailable'
        | 'authorization_unavailable'
    }>

export type ManageNotificationsDeps = Readonly<{
  authorizeProviderCall: (
    organizationId: OrganizationId,
    connectionId: string,
  ) => Promise<NotificationProviderAuthorizationResult>
  notifications: MyBusinessNotificationsPort
  /** Shared Pub/Sub topic, e.g. `projects/<proj>/topics/gbp-reviews`. Empty = disabled. */
  pubsubTopic: string
  notificationTypes: ReadonlyArray<GbpNotificationType>
  logger: LoggerPort
}>

/**
 * Why `subscribe` reports an outcome instead of returning void: it swallows
 * every failure by design, so a void return left NO caller — the import path or
 * the ops backfill — able to tell "Google is now publishing" from "we gave up".
 * The enum is content-free and safe to log.
 */
export type GbpSubscribeOutcome =
  | 'subscribed'
  | 'topic_unset'
  | 'connection_missing'
  | 'connection_inactive'
  | 'token_unavailable'
  | 'authorization_unavailable'
  | 'account_unresolved'
  | 'provider_failed'

/** Lifecycle API returned by the use case. Both methods are best-effort. */
export type ManageNotificationsApi = Readonly<{
  subscribe: (
    organizationId: OrganizationId,
    connectionId: string,
  ) => Promise<GbpSubscribeOutcome>
  unsubscribe: (organizationId: OrganizationId, connectionId: string) => Promise<void>
}>

export const manageNotifications = (
  deps: ManageNotificationsDeps,
): ManageNotificationsApi => {
  const distinctTargets = (
    authorized: Extract<NotificationProviderAuthorizationResult, { ok: true }>,
  ) =>
    authorized.targets.filter(
      (target, index, targets) =>
        targets.findIndex(
          (candidate) => candidate.gbpAccountId === target.gbpAccountId,
        ) === index,
    )

  const subscribe: ManageNotificationsApi['subscribe'] = async (
    organizationId,
    connectionId,
  ) => {
    if (!deps.pubsubTopic) {
      deps.logger.warn(
        { envVar: 'GBP_PUBSUB_TOPIC' },
        'GBP push notifications disabled (GBP_PUBSUB_TOPIC is empty); new reviews arrive only via the discovery sweep',
      )
      return 'topic_unset'
    }

    let authorized: NotificationProviderAuthorizationResult
    try {
      authorized = await deps.authorizeProviderCall(organizationId, connectionId)
    } catch (err) {
      deps.logger.warn({ err }, 'GBP notifications authorization unavailable')
      return 'authorization_unavailable'
    }
    if (!authorized.ok) return authorized.code

    const targets = distinctTargets(authorized)
    if (targets.length === 0) return 'account_unresolved'

    let providerFailed = false
    for (const target of targets) {
      try {
        await deps.notifications.subscribe({
          accessToken: target.accessToken,
          authorization: target.authorization,
          gbpAccountId: target.gbpAccountId,
          pubsubTopic: deps.pubsubTopic,
          notificationTypes: deps.notificationTypes,
        })
      } catch (err) {
        providerFailed = true
        deps.logger.warn({ err }, 'GBP notifications subscribe failed — continuing')
      }
    }
    if (providerFailed) return 'provider_failed'
    deps.logger.info('GBP notifications: subscribed')
    return 'subscribed'
  }

  const unsubscribe: ManageNotificationsApi['unsubscribe'] = async (
    organizationId,
    connectionId,
  ) => {
    try {
      const authorized = await deps.authorizeProviderCall(organizationId, connectionId)
      if (!authorized.ok) return

      for (const target of distinctTargets(authorized)) {
        try {
          await deps.notifications.unsubscribe({
            accessToken: target.accessToken,
            authorization: target.authorization,
            gbpAccountId: target.gbpAccountId,
          })
        } catch (err) {
          deps.logger.warn({ err }, 'GBP notifications unsubscribe failed — continuing')
        }
      }
      deps.logger.info('GBP notifications: unsubscribed')
    } catch (err) {
      deps.logger.warn({ err }, 'GBP notifications unsubscribe failed — continuing')
    }
  }

  return { subscribe, unsubscribe }
}
