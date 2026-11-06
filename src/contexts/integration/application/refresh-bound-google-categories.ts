import type { AuthContext } from '#/shared/domain/auth-context'
import { propertyId } from '#/shared/domain/ids'
import type {
  PropertyGoogleBindingPublicApi,
  PropertyPublicApi,
} from '#/contexts/property/application/public-api'
import type { GoogleConnection } from '../domain/types'
import { integrationError } from '../domain/errors'
import type { GoogleImportCommandAuthorizer } from './google-import-discovery'
import type { GoogleBusinessInformationPort } from './google-provider-contract'
import { googleImportProviderAuthorization } from './google-authorization-vector'

type RefreshCategoryDeps = Readonly<{
  findPropertyIds: PropertyPublicApi['findIdsByGoogleConnection']
  binding: Pick<PropertyGoogleBindingPublicApi, 'readInternal' | 'refreshPrimaryCategory'>
  authorize: GoogleImportCommandAuthorizer
  locations: GoogleBusinessInformationPort
  clock: () => Date
}>

async function readActiveBindings(
  deps: RefreshCategoryDeps,
  connection: GoogleConnection,
  actor: AuthContext,
) {
  const ids = await deps.findPropertyIds(connection.id, actor.organizationId)
  const bindings = []
  for (const id of ids) {
    const binding = await deps.binding.readInternal(actor.organizationId, propertyId(id))
    if (
      binding?.state === 'active' &&
      binding.connectionId === connection.id &&
      binding.accountId &&
      binding.locationId &&
      !binding.deletedAt
    )
      bindings.push(binding)
  }
  return bindings
}

async function readAuthorizedPage(
  deps: RefreshCategoryDeps,
  connection: GoogleConnection,
  actor: AuthContext,
  accountId: string,
  pageToken: string | undefined,
) {
  const admitted = await deps.authorize({
    actor,
    connectionId: connection.id,
    phase: 'provider_call',
    requireAccessToken: true,
  })
  if (
    !admitted.ok ||
    !admitted.accessToken ||
    admitted.authorization.connectionLifecycleVersion !== connection.lifecycleVersion ||
    admitted.authorization.connectionAccessVersion !== connection.accessVersion
  ) {
    throw integrationError(
      'oauth_failed',
      'Google category refresh authority unavailable',
    )
  }
  const authorization = admitted.authorization
  const page = await deps.locations.listLocations({
    accountId,
    // Only the account suffix is needed to read its bound locations.
    accountDisplayName: accountId,
    pageToken,
    accessToken: admitted.accessToken,
    authorization: googleImportProviderAuthorization(authorization),
  })
  const readAt = deps.clock()
  const publish = await deps.authorize({
    actor,
    connectionId: connection.id,
    phase: 'publish',
    expected: authorization,
    requireAccessToken: false,
  })
  if (!publish.ok) {
    throw integrationError('oauth_failed', 'Google category refresh authority changed')
  }
  return { page, readAt }
}

/** Reconnect refreshes provider hints without changing the confirmed Property profile. */
export function createRefreshBoundGoogleCategories(deps: RefreshCategoryDeps) {
  return async (
    connection: GoogleConnection,
    actor: AuthContext,
    refreshEventId: string,
  ): Promise<void> => {
    const bindings = await readActiveBindings(deps, connection, actor)
    const accounts = new Set(bindings.map((binding) => binding.accountId!))
    for (const accountId of accounts) {
      const pending = new Map(
        bindings
          .filter((binding) => binding.accountId === accountId)
          .map((binding) => [binding.locationId!, binding]),
      )
      let pageToken: string | undefined
      const seen = new Set<string>()
      do {
        const { page, readAt } = await readAuthorizedPage(
          deps,
          connection,
          actor,
          accountId,
          pageToken,
        )
        for (const item of page.items) {
          const binding = pending.get(item.binding.locationId)
          if (!binding || item.binding.accountId !== accountId) continue
          await deps.binding.refreshPrimaryCategory({
            organizationId: actor.organizationId,
            propertyId: binding.propertyId,
            connectionId: connection.id,
            accountId,
            locationId: item.binding.locationId,
            expectedConnectionLifecycleVersion: connection.lifecycleVersion,
            expectedConnectionAccessVersion: connection.accessVersion,
            expectedSourceEpoch: binding.sourceEpoch,
            expectedProfileVersion: binding.profileVersion,
            category: item.primaryCategory,
            refreshEventId,
            readAt,
          })
          pending.delete(item.binding.locationId)
        }
        pageToken = page.nextPageToken ?? undefined
        if (pageToken && seen.has(pageToken)) {
          throw integrationError('oauth_failed', 'Google category refresh page repeated')
        }
        if (pageToken) seen.add(pageToken)
      } while (pageToken && pending.size > 0)
    }
  }
}
