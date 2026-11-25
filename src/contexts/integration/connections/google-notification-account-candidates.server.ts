import type { OrganizationId } from '#/shared/domain/ids'
import {
  activeNotificationBindings,
  type NotificationBindingReads,
} from './google-notification-active-bindings.server'
import type { GoogleNotificationAccounts } from './google-notification-accounts.port.server'

export type GoogleNotificationAccountCandidate = Readonly<{
  organizationId: OrganizationId
  connectionId: string
  gbpAccountId: string
  attemptedAt: number | null
}>

export function createGoogleNotificationAccountCandidates(
  deps: NotificationBindingReads & {
    accounts: Pick<GoogleNotificationAccounts, 'read'>
  },
) {
  return async (): Promise<ReadonlyArray<GoogleNotificationAccountCandidate>> => {
    const candidates: GoogleNotificationAccountCandidate[] = []
    const attempted = new Map<string, number | null>()
    const listed = new Set<string>()
    for await (const binding of activeNotificationBindings(deps)) {
      const key = `${binding.connectionId}:${binding.accountId}`
      if (listed.has(key)) continue
      listed.add(key)
      if (!attempted.has(binding.accountId))
        attempted.set(
          binding.accountId,
          (await deps.accounts.read(binding.accountId))?.attemptedAt ?? null,
        )
      candidates.push({
        organizationId: binding.organizationId,
        connectionId: binding.connectionId,
        gbpAccountId: binding.accountId,
        attemptedAt: attempted.get(binding.accountId) ?? null,
      })
    }
    return candidates
  }
}
