// Integration context — which GBP accounts a connection may manage push for.
//
// Google's notification setting is account-scoped, and RepKey holds no
// account-wide authority: it may touch an account only through a Property that
// is actively bound to it on this connection. So every active binding of the
// connection is read, each distinct account is authorized once — through the
// first of its Properties, in id order, that authorizes, under that Property's
// exact source epoch and the notification system principal — and nothing is
// ever targeted from provider discovery. A bound account no Property could authorize is counted, so the
// caller can report it rather than call the connection subscribed.
//
// A connection with no usable binding yet (connected, not imported) answers
// with no targets rather than a refusal: there is simply no account to
// subscribe, and the daily reconciliation must not count it as a failure.

import {
  googleConnectionId,
  propertyId,
  type GoogleConnectionId,
  type OrganizationId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { GoogleConnection } from '../domain/types'
import type { GoogleReviewSyncAuthorizer } from './google-review-sync-authorizer'
import type {
  ManageNotificationsDeps,
  NotificationProviderAuthorizationResult,
} from './use-cases/manage-notifications'

/** The part of a Property's Google binding this decision reads. */
export type NotificationBindingView = Readonly<{
  connectionId: string | null
  accountId: string | null
  state: string
  lifecycleState: string
  deletedAt: Date | null
  sourceEpoch: number
}>

type NotificationTarget = Extract<
  NotificationProviderAuthorizationResult,
  { ok: true }
>['targets'][number]

const UNAVAILABLE = Object.freeze({
  ok: false,
  code: 'authorization_unavailable',
} as const)

const usableBinding = (
  binding: NotificationBindingView | null,
  connectionId: GoogleConnectionId,
): binding is NotificationBindingView & { accountId: string } =>
  binding !== null &&
  binding.connectionId === connectionId &&
  Boolean(binding.accountId) &&
  binding.state === 'active' &&
  binding.lifecycleState === 'active' &&
  binding.deletedAt === null

export function createGoogleNotificationProviderAuthorizer(
  deps: Readonly<{
    findConnection: (
      organizationId: OrganizationId,
      connectionId: GoogleConnectionId,
    ) => Promise<GoogleConnection | null>
    findLinkedPropertyIds: (
      connectionId: GoogleConnectionId,
      organizationId: OrganizationId,
    ) => Promise<ReadonlyArray<string>>
    readBinding: (
      organizationId: OrganizationId,
      propertyId: PropertyId,
    ) => Promise<NotificationBindingView | null>
    authorizeSystemCall: GoogleReviewSyncAuthorizer
  }>,
): ManageNotificationsDeps['authorizeProviderCall'] {
  return async (organizationId, connectionIdValue) => {
    const connectionId = googleConnectionId(connectionIdValue)
    let connection: GoogleConnection | null
    let linkedPropertyIds: ReadonlyArray<string>
    try {
      connection = await deps.findConnection(organizationId, connectionId)
      if (!connection) return { ok: false, code: 'connection_missing' }
      if (connection.status !== 'active' || connection.credentialUseState !== 'active') {
        return { ok: false, code: 'connection_inactive' }
      }
      linkedPropertyIds = await deps.findLinkedPropertyIds(connectionId, organizationId)
    } catch {
      return UNAVAILABLE
    }

    const targets: NotificationTarget[] = []
    const targetedAccounts = new Set<string>()
    const boundAccounts = new Set<string>()
    for (const linkedPropertyId of [...linkedPropertyIds].sort()) {
      const property = propertyId(linkedPropertyId)
      let binding: NotificationBindingView | null
      try {
        binding = await deps.readBinding(organizationId, property)
      } catch {
        return UNAVAILABLE
      }
      if (!usableBinding(binding, connectionId)) continue
      boundAccounts.add(binding.accountId)
      if (targetedAccounts.has(binding.accountId)) continue
      const authorized = await deps.authorizeSystemCall({
        organizationId,
        propertyId: property,
        connectionId,
        sourceEpoch: binding.sourceEpoch,
        operationKey: 'notifications.manage',
      })
      if (authorized.ok) {
        targetedAccounts.add(binding.accountId)
        targets.push({
          accessToken: authorized.accessToken,
          authorization: authorized.authorization,
          gbpAccountId: binding.accountId,
        })
        continue
      }
      if (authorized.code === 'runtime_unavailable') return UNAVAILABLE
    }
    if (targets.length === 0 && boundAccounts.size > 0) return UNAVAILABLE
    return {
      ok: true,
      targets: Object.freeze(targets),
      unauthorizedAccounts: boundAccounts.size - targetedAccounts.size,
    }
  }
}
