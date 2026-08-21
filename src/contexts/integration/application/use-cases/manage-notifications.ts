// Integration context — manage GBP Pub/Sub notifications use case (step 3/3).
// Subscribes (on first property import) and unsubscribes (on disconnect) a GBP
// account to/from the shared Pub/Sub topic. Best-effort: every failure is logged
// and swallowed — notifications are an optimization over the existing sync/poll,
// never a correctness gate (ADR-deferred item #2).
//
// The GBP account suffix required by `updateNotificationSetting` is never a
// stored OAuth identity. It is resolved from `gbpApi.listAccounts(accessToken)`;
// a later account-selection contract replaces this v1 first-account behavior.

import type { GoogleConnectionRepository } from '../ports/google-connection.repository'
import type { GbpApiPort } from '../ports/gbp-api.port'
import type { TokenEncryptionPort } from '../ports/token-encryption.port'
import type { MyBusinessNotificationsPort } from '../ports/mybusiness-notifications.port'
import type { GoogleConnection } from '../../domain/types'
import type { OrganizationId } from '#/shared/domain/ids'
import { googleConnectionId } from '#/shared/domain/ids'
import { TOKEN_EXPIRY_BUFFER_MS } from '../constants'
import type { LoggerPort } from '#/shared/domain/logger.port'

export type ManageNotificationsDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
  gbpApi: GbpApiPort
  encryption: TokenEncryptionPort
  refreshGoogleToken: (
    organizationId: OrganizationId,
    connectionId: string,
  ) => Promise<GoogleConnection>
  notifications: MyBusinessNotificationsPort
  /** Shared Pub/Sub topic, e.g. `projects/<proj>/topics/gbp-reviews`. Empty = disabled. */
  pubsubTopic: string
  notificationTypes: ReadonlyArray<string>
  clock: () => Date
  logger: LoggerPort
}>

/**
 * Why `subscribe` reports an outcome instead of returning void: it swallows
 * every failure by design, so a void return left NO caller — the import path or
 * the ops backfill — able to tell "Google is now publishing" from "we gave up
 * six branches ago". The enum is content-free and safe to log.
 */
export type GbpSubscribeOutcome =
  /** Google is publishing `notificationTypes` to `pubsubTopic` for this account. */
  | 'subscribed'
  /** GBP_PUBSUB_TOPIC is empty — push is disabled deployment-wide. */
  | 'topic_unset'
  | 'connection_missing'
  | 'connection_inactive'
  /** Decrypt/refresh failed; the connection needs reconnecting. */
  | 'token_unavailable'
  /** listAccounts returned nothing usable for the account suffix. */
  | 'account_unresolved'
  /** updateNotificationSetting itself failed (transient or permission). */
  | 'provider_failed'

/** Lifecycle API returned by the use case. Both methods are best-effort (never throw). */
export type ManageNotificationsApi = Readonly<{
  subscribe: (
    organizationId: OrganizationId,
    connectionId: string,
  ) => Promise<GbpSubscribeOutcome>
  unsubscribe: (organizationId: OrganizationId, connectionId: string) => Promise<void>
}>

/** Extracts the account id from a GBP `accounts/{id}` name. */
const extractAccountId = (name: string): string =>
  name.startsWith('accounts/') ? name.slice('accounts/'.length) : name

export const manageNotifications = (
  deps: ManageNotificationsDeps,
): ManageNotificationsApi => {
  /** Returns a usable access token, refreshing if expired, or null on failure. */
  const resolveAccessToken = async (
    organizationId: OrganizationId,
    connectionId: string,
    connection: GoogleConnection,
  ): Promise<string | null> => {
    try {
      const now = deps.clock().getTime()
      const expiresAt = connection.tokenExpiresAt.getTime()
      if (expiresAt <= now + TOKEN_EXPIRY_BUFFER_MS) {
        const refreshed = await deps.refreshGoogleToken(organizationId, connectionId)
        return deps.encryption.decrypt(refreshed.encryptedAccessToken)
      }
      return deps.encryption.decrypt(connection.encryptedAccessToken)
    } catch (err) {
      deps.logger.warn({ err }, 'GBP notifications: token resolution failed')
      return null
    }
  }

  /** Returns the first GBP account id via listAccounts, or null. */
  const resolveGbpAccountId = async (accessToken: string): Promise<string | null> => {
    try {
      const accounts = await deps.gbpApi.listAccounts(accessToken)
      const first = accounts[0]
      if (!first?.name) return null
      return extractAccountId(first.name)
    } catch (err) {
      deps.logger.warn(
        { err },
        'GBP notifications: account-id resolution (listAccounts) failed',
      )
      return null
    }
  }

  const subscribe: ManageNotificationsApi['subscribe'] = async (
    organizationId,
    connectionId,
  ) => {
    // Disabled when no topic is configured (dev/test, and every deployment
    // that never finished the GCP setup). This used to return in silence, so
    // nothing in the logs distinguished "GBP push is dark" from "GBP push is
    // working" — and with the webhook dark, new reviews only ever arrive on
    // the discovery sweep's cadence.
    if (!deps.pubsubTopic) {
      deps.logger.warn(
        { envVar: 'GBP_PUBSUB_TOPIC' },
        'GBP push notifications disabled (GBP_PUBSUB_TOPIC is empty); new reviews arrive only via the discovery sweep',
      )
      return 'topic_unset'
    }
    try {
      const connection = await deps.connectionRepo.findById(
        organizationId,
        googleConnectionId(connectionId),
      )
      if (!connection) return 'connection_missing'
      if (connection.status !== 'active') return 'connection_inactive'

      const accessToken = await resolveAccessToken(
        organizationId,
        connectionId,
        connection,
      )
      if (!accessToken) return 'token_unavailable'

      const gbpAccountId = await resolveGbpAccountId(accessToken)
      if (!gbpAccountId) return 'account_unresolved'

      await deps.notifications.subscribe({
        accessToken,
        gbpAccountId,
        pubsubTopic: deps.pubsubTopic,
        notificationTypes: deps.notificationTypes,
      })
      // `updateNotificationSetting` is a PATCH of the account's single
      // notificationSetting resource, so this is idempotent: re-running it
      // (re-import, relink, ops backfill, topic change) just re-asserts the
      // topic rather than creating a second subscription or erroring.
      deps.logger.info('GBP notifications: subscribed')
      return 'subscribed'
    } catch (err) {
      deps.logger.warn({ err }, 'GBP notifications subscribe failed — continuing')
      return 'provider_failed'
    }
  }

  const unsubscribe: ManageNotificationsApi['unsubscribe'] = async (
    organizationId,
    connectionId,
  ) => {
    try {
      const connection = await deps.connectionRepo.findById(
        organizationId,
        googleConnectionId(connectionId),
      )
      if (!connection) return

      const accessToken = await resolveAccessToken(
        organizationId,
        connectionId,
        connection,
      )
      if (!accessToken) return

      const gbpAccountId = await resolveGbpAccountId(accessToken)
      if (!gbpAccountId) return

      await deps.notifications.unsubscribe({ accessToken, gbpAccountId })
      deps.logger.info('GBP notifications: unsubscribed')
    } catch (err) {
      deps.logger.warn({ err }, 'GBP notifications unsubscribe failed — continuing')
    }
  }

  return { subscribe, unsubscribe }
}
