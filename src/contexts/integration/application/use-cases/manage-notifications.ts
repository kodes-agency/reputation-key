// Integration context — manage GBP Pub/Sub notifications use case (step 3/3).
// Subscribes (on first property import) and unsubscribes (on disconnect) a GBP
// account to/from the shared Pub/Sub topic. Best-effort: every failure is logged
// and swallowed — notifications are an optimization over the existing sync/poll,
// never a correctness gate (ADR-deferred item #2).
//
// The GBP account id required by `updateNotificationSetting` is NOT the stored
// `connection.googleAccountId` (the OAuth userinfo id) — it is resolved from
// `gbpApi.listAccounts(accessToken)` (first account). v1 assumes one primary
// GBP account per connection; see the plan's account-ID verification gate.

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

/** Lifecycle API returned by the use case. Both methods are best-effort (never throw). */
export type ManageNotificationsApi = Readonly<{
  subscribe: (organizationId: OrganizationId, connectionId: string) => Promise<void>
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
      deps.logger.warn(
        { err, organizationId, connectionId },
        'GBP notifications: token resolution failed',
      )
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
    // Disabled when no topic is configured (dev/test) — no-op.
    if (!deps.pubsubTopic) return
    try {
      const connection = await deps.connectionRepo.findById(
        organizationId,
        googleConnectionId(connectionId),
      )
      if (!connection || connection.status !== 'active') return

      const accessToken = await resolveAccessToken(
        organizationId,
        connectionId,
        connection,
      )
      if (!accessToken) return

      const gbpAccountId = await resolveGbpAccountId(accessToken)
      if (!gbpAccountId) return

      await deps.notifications.subscribe({
        accessToken,
        gbpAccountId,
        pubsubTopic: deps.pubsubTopic,
        notificationTypes: deps.notificationTypes,
      })
      deps.logger.info(
        { organizationId, connectionId, gbpAccountId },
        'GBP notifications: subscribed',
      )
    } catch (err) {
      deps.logger.warn(
        { err, organizationId, connectionId },
        'GBP notifications subscribe failed — continuing',
      )
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
      deps.logger.info(
        { organizationId, connectionId, gbpAccountId },
        'GBP notifications: unsubscribed',
      )
    } catch (err) {
      deps.logger.warn(
        { err, organizationId, connectionId },
        'GBP notifications unsubscribe failed — continuing',
      )
    }
  }

  return { subscribe, unsubscribe }
}
