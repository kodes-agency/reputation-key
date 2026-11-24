import {
  propertyId,
  type GoogleConnectionId,
  type OrganizationId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { GoogleConnection } from '../domain/types'
import type { NotificationBindingView } from './google-notification-provider-authorizer.server'

export type NotificationBindingReads = Readonly<{
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
}>

export type ActiveNotificationBinding = Readonly<{
  organizationId: OrganizationId
  connectionId: GoogleConnectionId
  accountId: string
}>

/** Walks every active connection's Properties through tenant-scoped reads and
 * yields each active binding that names an account. `skip` leaves a connection
 * out before its Properties are read; `beforeRead` runs ahead of every read. */
export async function* activeNotificationBindings(
  reads: NotificationBindingReads,
  options: Readonly<{
    skip?: (organizationId: OrganizationId, connection: GoogleConnection) => boolean
    beforeRead?: () => void
  }> = {},
): AsyncGenerator<ActiveNotificationBinding> {
  const beforeRead = options.beforeRead ?? (() => {})
  beforeRead()
  for (const organizationId of await reads.listOrganizations()) {
    beforeRead()
    for (const connection of await reads.listConnections(organizationId)) {
      if (connection.status !== 'active' || options.skip?.(organizationId, connection))
        continue
      beforeRead()
      for (const property of await reads.findLinkedPropertyIds(
        connection.id,
        organizationId,
      )) {
        beforeRead()
        const binding = await reads.readBinding(organizationId, propertyId(property))
        if (
          binding?.connectionId === connection.id &&
          binding.accountId &&
          binding.state === 'active' &&
          binding.lifecycleState === 'active' &&
          binding.deletedAt === null
        )
          yield {
            organizationId,
            connectionId: connection.id,
            accountId: binding.accountId,
          }
      }
    }
  }
}
