import {
  propertyId,
  type OrganizationId,
  type GoogleConnectionId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { GoogleConnection } from '../domain/types'
import type { NotificationBindingView } from './google-notification-provider-authorizer'
import type { GoogleNotificationAccounts } from './ports/google-notification-accounts.port'

export type GoogleNotificationAccountCandidate = Readonly<{
  organizationId: OrganizationId
  connectionId: string
  gbpAccountId: string
  attemptedAt: number | null
}>

export function createGoogleNotificationAccountCandidates(
  deps: Readonly<{
    listOrganizations: () => Promise<ReadonlyArray<OrganizationId>>
    listConnections: (
      organization: OrganizationId,
    ) => Promise<ReadonlyArray<GoogleConnection>>
    findLinkedPropertyIds: (
      connection: GoogleConnectionId,
      organization: OrganizationId,
    ) => Promise<ReadonlyArray<string>>
    readBinding: (
      organization: OrganizationId,
      property: PropertyId,
    ) => Promise<NotificationBindingView | null>
    accounts: Pick<GoogleNotificationAccounts, 'read'>
  }>,
) {
  return async (): Promise<ReadonlyArray<GoogleNotificationAccountCandidate>> => {
    const candidates: GoogleNotificationAccountCandidate[] = []
    const attempted = new Map<string, number | null>()
    for (const organization of await deps.listOrganizations()) {
      for (const connection of await deps.listConnections(organization)) {
        if (connection.status !== 'active') continue
        const seen = new Set<string>()
        for (const property of await deps.findLinkedPropertyIds(
          connection.id,
          organization,
        )) {
          const binding = await deps.readBinding(organization, propertyId(property))
          if (
            !binding ||
            binding.connectionId !== connection.id ||
            !binding.accountId ||
            binding.state !== 'active' ||
            binding.lifecycleState !== 'active' ||
            binding.deletedAt !== null ||
            seen.has(binding.accountId)
          )
            continue
          seen.add(binding.accountId)
          if (!attempted.has(binding.accountId))
            attempted.set(
              binding.accountId,
              (await deps.accounts.read(binding.accountId))?.attemptedAt ?? null,
            )
          candidates.push({
            organizationId: organization,
            connectionId: connection.id,
            gbpAccountId: binding.accountId,
            attemptedAt: attempted.get(binding.accountId) ?? null,
          })
        }
      }
    }
    return candidates
  }
}
