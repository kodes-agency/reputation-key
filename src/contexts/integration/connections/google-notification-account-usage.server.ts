import type { OrganizationId } from '#/shared/domain/ids'
import {
  activeNotificationBindings,
  type NotificationBindingReads,
} from './google-notification-active-bindings.server'

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
  reads: NotificationBindingReads,
): OtherNotificationAccountBinding {
  return async (input) => {
    let count = 0
    const bindings = activeNotificationBindings(reads, {
      skip: (organizationId, connection) =>
        organizationId === input.organizationId && connection.id === input.connectionId,
      beforeRead: () => {
        if (++count > MAX_USAGE_READS)
          throw new Error('Google notification account usage incomplete')
      },
    })
    for await (const binding of bindings)
      if (binding.accountId === input.gbpAccountId) return true
    return false
  }
}
