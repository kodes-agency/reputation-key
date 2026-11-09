import {
  propertyId,
  type GoogleConnectionId,
  type OrganizationId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { GoogleConnection } from '../domain/types'
import type { NotificationBindingView } from './google-notification-provider-authorizer'

// Disconnect must finish even when proving global absence requires too much
// work. Exhaustion retains the provider setting, just like a failed read.
const MAX_USAGE_READS = 1_000

export type OtherNotificationAccountBinding = (
  input: Readonly<{
    organizationId: OrganizationId
    connectionId: string
    gbpAccountId: string
  }>,
) => Promise<boolean>

/** Account settings are shared across tenants. This read returns only whether
 * another active binding needs the setting; it grants no provider authority.
 * Read failures propagate so an unavailable tenant cannot look unbound. */
export function createGoogleNotificationAccountUsageReader(
  deps: Readonly<{
    listOrganizations: () => Promise<ReadonlyArray<OrganizationId>>
    listConnections: (
      organizationId: OrganizationId,
    ) => Promise<ReadonlyArray<GoogleConnection>>
    findLinkedPropertyIds: (
      connectionId: GoogleConnectionId,
      organizationId: OrganizationId,
    ) => Promise<ReadonlyArray<string>>
    readBinding: (
      organizationId: OrganizationId,
      propertyId: PropertyId,
    ) => Promise<NotificationBindingView | null>
  }>,
): OtherNotificationAccountBinding {
  return async (input) => {
    let reads = 0
    const reserveRead = () => {
      if (++reads > MAX_USAGE_READS)
        throw new Error('Google notification account usage incomplete')
    }
    reserveRead()
    for (const organization of await deps.listOrganizations()) {
      reserveRead()
      for (const connection of await deps.listConnections(organization)) {
        if (
          (organization === input.organizationId &&
            connection.id === input.connectionId) ||
          connection.status !== 'active'
        )
          continue
        reserveRead()
        for (const property of await deps.findLinkedPropertyIds(
          connection.id,
          organization,
        )) {
          reserveRead()
          const binding = await deps.readBinding(organization, propertyId(property))
          if (
            binding?.connectionId === connection.id &&
            binding.accountId === input.gbpAccountId &&
            binding.state === 'active' &&
            binding.lifecycleState === 'active' &&
            binding.deletedAt === null
          )
            return true
        }
      }
    }
    return false
  }
}
