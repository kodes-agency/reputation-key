import type { GoogleNotificationAccounts } from '../ports/google-notification-accounts.port'
// Integration context — govern the GBP Pub/Sub notification desired state.
//
// This use case deliberately receives an already-governed provider
// authorization instead of reading/decrypting connection credentials itself.
// Each exact account comes from an active Property binding; notification-
// setting reads/writes carry that Property's frozen authorization vector.

import type { GoogleProviderCallAuthorization } from '../google-provider-contract'
import type {
  GbpAccountSubscription,
  GbpNotificationType,
  MyBusinessNotificationsPort,
} from '../ports/mybusiness-notifications.port'
import { isGbpApiError } from '../../domain/gbp-api-error'
import { googleCallError } from '../../domain/google-call-error'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { OrganizationId } from '#/shared/domain/ids'
import type { OtherNotificationAccountBinding } from '../google-notification-account-usage'

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
      /**
       * Bound accounts no Property of the connection could authorize (a
       * denied or stale binding). Counted as failed, so a partly refused
       * connection is not reported as fully subscribed.
       */
      unauthorizedAccounts?: number
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
  accounts: GoogleNotificationAccounts
  nowMs: () => number
  hasOtherActiveAccountBinding: OtherNotificationAccountBinding
  authorizeProviderCall: (
    organizationId: OrganizationId,
    connectionId: string,
    gbpAccountId?: string,
  ) => Promise<NotificationProviderAuthorizationResult>
  notifications: MyBusinessNotificationsPort
  /** Shared Pub/Sub topic, e.g. `projects/<proj>/topics/gbp-reviews`. Empty = disabled. */
  pubsubTopic: string
  notificationTypes: ReadonlyArray<GbpNotificationType>
  logger: LoggerPort
}>

/**
 * Why `subscribe` reports an outcome instead of returning void: it swallows
 * every failure by design, so a void return left NO caller — the import path,
 * the ops backfill or the daily reconciliation — able to tell "Google is now
 * publishing" from "we gave up". The enum is content-free and safe to log.
 *
 * `subscribed`: every bound account now publishes to the topic, and at least
 * one needed the write. `already_subscribed`: every one already did, so
 * nothing was written.
 */
export type GbpSubscribeOutcome =
  | 'subscribed'
  | 'already_subscribed'
  | 'topic_unset'
  | 'connection_missing'
  | 'connection_inactive'
  | 'token_unavailable'
  | 'authorization_unavailable'
  | 'account_unresolved'
  | 'provider_failed'

/**
 * What happened to each exact GBP account the attempt reached. Google stores
 * the notification setting per account, so this — not the connection — is the
 * unit that is or is not publishing. Counts and codes only.
 */
export type GbpAccountTally = Readonly<{
  subscribed: number
  alreadySubscribed: number
  failed: number
  /** Failure code → accounts, e.g. `coordination_unavailable`, `provider_403`. */
  failureCodes: Readonly<Record<string, number>>
}>

export type GbpSubscribeResult = Readonly<{
  outcome: GbpSubscribeOutcome
  accounts: GbpAccountTally
}>

/**
 * Why `unsubscribe` reports an outcome too. It swallows every failure by design:
 * a disconnect and an Organization closing go on whether or not Google was
 * told. A void return therefore read the same for "every account was cleared",
 * "the unsubscribe was refused", "there was no account to target" and "Google
 * refused the write", and the closing evidence counted all four as stopped.
 *
 * `unsubscribed`: every bound account's setting was cleared and read back. The
 * refusal codes mean nothing was sent. `provider_failed`: at least one bound
 * account was not cleared (Google refused, the write could not be confirmed, or
 * no Property could authorize the account). An account another connection still
 * needs is retained and reported as `account_still_bound`, never as cleared.
 */
export type GbpUnsubscribeOutcome =
  | 'unsubscribed'
  | 'connection_missing'
  | 'connection_inactive'
  | 'token_unavailable'
  | 'authorization_unavailable'
  | 'account_unresolved'
  | 'provider_failed'

/** What happened to each exact GBP account the unsubscribe reached. Counts and codes only. */
export type GbpUnsubscribeTally = Readonly<{
  unsubscribed: number
  failed: number
  /** Failure code → accounts, as in `GbpAccountTally`. */
  failureCodes: Readonly<Record<string, number>>
}>

export type GbpUnsubscribeResult = Readonly<{
  outcome: GbpUnsubscribeOutcome
  accounts: GbpUnsubscribeTally
}>

/** Lifecycle API returned by the use case. Both methods are best-effort. */
export type GbpSubscribeScope = Readonly<{
  gbpAccountId: string
  reuseVerified?: boolean
  connectionId?: string
}>

export type ManageNotificationsApi = Readonly<{
  subscribe: (
    organizationId: OrganizationId,
    connectionId: string,
    scope?: GbpSubscribeScope,
  ) => Promise<GbpSubscribeResult>
  unsubscribe: (
    organizationId: OrganizationId,
    connectionId: string,
  ) => Promise<GbpUnsubscribeResult>
}>

export const NO_GBP_ACCOUNTS: GbpAccountTally = Object.freeze({
  subscribed: 0,
  alreadySubscribed: 0,
  failed: 0,
  failureCodes: Object.freeze({}),
})

const NO_GBP_ACCOUNTS_UNSUBSCRIBED: GbpUnsubscribeTally = Object.freeze({
  unsubscribed: 0,
  failed: 0,
  failureCodes: Object.freeze({}),
})

/** Adds tallies up, merging failure codes. */
export const sumGbpAccountTallies = (
  tallies: ReadonlyArray<GbpAccountTally>,
): GbpAccountTally => {
  const failureCodes: Record<string, number> = {}
  for (const tally of tallies) {
    for (const [code, count] of Object.entries(tally.failureCodes)) {
      failureCodes[code] = (failureCodes[code] ?? 0) + count
    }
  }
  return {
    subscribed: tallies.reduce((sum, tally) => sum + tally.subscribed, 0),
    alreadySubscribed: tallies.reduce((sum, tally) => sum + tally.alreadySubscribed, 0),
    failed: tallies.reduce((sum, tally) => sum + tally.failed, 0),
    failureCodes,
  }
}

/**
 * The most specific content-free reason an account's subscribe failed: our own
 * admission's refusal (`coordination_unavailable`, `authorization_changed`, …)
 * before Google's answer, then the executor's code, then the error kind.
 */
const gbpNotificationFailureCode = (error: unknown): string => {
  if (!isGbpApiError(error)) return 'unexpected_error'
  const call = googleCallError(error)
  if (error.executionAdmissionCode && call.executionCode) return call.executionCode
  if (call.providerStatus !== null) return `provider_${call.providerStatus}`
  return call.executionCode ?? call.code
}

const connectionOutcome = (accounts: GbpAccountTally): GbpSubscribeOutcome => {
  if (accounts.failed > 0) return 'provider_failed'
  return accounts.subscribed > 0 ? 'subscribed' : 'already_subscribed'
}

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
    scope,
  ) => {
    if (!deps.pubsubTopic) {
      deps.logger.warn(
        { envVar: 'GBP_PUBSUB_TOPIC' },
        'GBP push notifications disabled (GBP_PUBSUB_TOPIC is empty); new reviews arrive only via the discovery sweep',
      )
      return { outcome: 'topic_unset', accounts: NO_GBP_ACCOUNTS }
    }

    let authorized: NotificationProviderAuthorizationResult
    try {
      authorized = await (scope
        ? deps.authorizeProviderCall(organizationId, connectionId, scope.gbpAccountId)
        : deps.authorizeProviderCall(organizationId, connectionId))
    } catch (err) {
      deps.logger.warn(
        { errorName: err instanceof Error ? err.name : 'unknown' },
        'GBP notifications authorization unavailable',
      )
      return { outcome: 'authorization_unavailable', accounts: NO_GBP_ACCOUNTS }
    }
    if (!authorized.ok) return { outcome: authorized.code, accounts: NO_GBP_ACCOUNTS }

    const targets = distinctTargets(authorized).filter(
      (target) => !scope || target.gbpAccountId === scope.gbpAccountId,
    )
    if (targets.length === 0) {
      return { outcome: 'account_unresolved', accounts: NO_GBP_ACCOUNTS }
    }

    let subscribed = 0
    let alreadySubscribed = 0
    const failureCodes: Record<string, number> = {}
    if (authorized.unauthorizedAccounts) {
      failureCodes.authorization_denied = authorized.unauthorizedAccounts
    }
    for (const target of targets) {
      let result: GbpAccountSubscription
      try {
        result = await deps.accounts.withAccount(target.gbpAccountId, async () => {
          const configuration = JSON.stringify([
            deps.pubsubTopic,
            [...deps.notificationTypes].sort(),
          ])
          const previous = scope?.reuseVerified
            ? await deps.accounts.read(target.gbpAccountId)
            : null
          if (
            previous?.configuration === configuration &&
            previous.verifiedAt !== null &&
            previous.verifiedAt <= deps.nowMs() &&
            deps.nowMs() - previous.verifiedAt < 24 * 60 * 60 * 1_000
          ) {
            return 'already_subscribed'
          }
          await deps.accounts.attempted(target.gbpAccountId)
          await deps.accounts.invalidate(target.gbpAccountId)
          const outcome = await deps.notifications.subscribe({
            accessToken: target.accessToken,
            authorization: target.authorization,
            gbpAccountId: target.gbpAccountId,
            pubsubTopic: deps.pubsubTopic,
            notificationTypes: deps.notificationTypes,
          })
          await deps.accounts.verified(target.gbpAccountId, configuration)
          return outcome
        })
      } catch (err) {
        const code = gbpNotificationFailureCode(err)
        failureCodes[code] = (failureCodes[code] ?? 0) + 1
        // Code and error class only: the daily run repeats this per account.
        deps.logger.warn(
          { code, errorName: err instanceof Error ? err.name : 'unknown' },
          'GBP notifications subscribe failed — continuing',
        )
        continue
      }
      if (result === 'subscribed') subscribed += 1
      else alreadySubscribed += 1
    }
    const accounts: GbpAccountTally = {
      subscribed,
      alreadySubscribed,
      failed: Object.values(failureCodes).reduce((sum, count) => sum + count, 0),
      failureCodes,
    }
    const outcome = connectionOutcome(accounts)
    if (outcome === 'subscribed') {
      deps.logger.info({ subscribed, alreadySubscribed }, 'GBP notifications: subscribed')
    }
    return { outcome, accounts }
  }

  /** Clear every bound account's setting; never throws, always says what happened. */
  const clearBoundAccounts = async (
    organizationId: OrganizationId,
    connectionId: string,
  ): Promise<GbpUnsubscribeResult> => {
    let authorized: NotificationProviderAuthorizationResult
    try {
      authorized = await deps.authorizeProviderCall(organizationId, connectionId)
    } catch {
      return {
        outcome: 'authorization_unavailable',
        accounts: NO_GBP_ACCOUNTS_UNSUBSCRIBED,
      }
    }
    if (!authorized.ok) {
      return { outcome: authorized.code, accounts: NO_GBP_ACCOUNTS_UNSUBSCRIBED }
    }

    const targets = distinctTargets(authorized)
    if (targets.length === 0) {
      return { outcome: 'account_unresolved', accounts: NO_GBP_ACCOUNTS_UNSUBSCRIBED }
    }

    let unsubscribed = 0
    const failureCodes: Record<string, number> = {}
    if (authorized.unauthorizedAccounts) {
      failureCodes.authorization_denied = authorized.unauthorizedAccounts
    }
    for (const target of targets) {
      try {
        const cleared = await deps.accounts.withAccount(target.gbpAccountId, async () => {
          // Invalidate before the write: a failed or uncertain clear cannot
          // leave an import trusting an earlier successful subscription.
          await deps.accounts.invalidate(target.gbpAccountId)
          if (
            await deps.hasOtherActiveAccountBinding({
              organizationId,
              connectionId,
              gbpAccountId: target.gbpAccountId,
            })
          )
            return false
          await deps.notifications.unsubscribe({
            accessToken: target.accessToken,
            authorization: target.authorization,
            gbpAccountId: target.gbpAccountId,
          })
          return true
        })
        if (cleared) unsubscribed += 1
        else
          failureCodes.account_still_bound = (failureCodes.account_still_bound ?? 0) + 1
      } catch (err) {
        const code = gbpNotificationFailureCode(err)
        failureCodes[code] = (failureCodes[code] ?? 0) + 1
        // Code and error class only, as the subscribe path logs a failed account.
        deps.logger.warn(
          { code, errorName: err instanceof Error ? err.name : 'unknown' },
          'GBP notifications unsubscribe failed — continuing',
        )
      }
    }
    const failed = Object.values(failureCodes).reduce((sum, count) => sum + count, 0)
    return {
      outcome: failed > 0 ? 'provider_failed' : 'unsubscribed',
      accounts: { unsubscribed, failed, failureCodes },
    }
  }

  const unsubscribe: ManageNotificationsApi['unsubscribe'] = async (
    organizationId,
    connectionId,
  ) => {
    const result = await clearBoundAccounts(organizationId, connectionId)
    if (result.outcome === 'unsubscribed') {
      deps.logger.info(
        { unsubscribed: result.accounts.unsubscribed },
        'GBP notifications: unsubscribed',
      )
    } else {
      // Outcome, counts and codes only. The caller goes on regardless.
      deps.logger.warn(
        { outcome: result.outcome, ...result.accounts },
        'GBP notifications not unsubscribed — continuing',
      )
    }
    return result
  }

  return { subscribe, unsubscribe }
}
