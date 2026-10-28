import type { QueryClient } from '@tanstack/react-query'
import { shellContextForgotten } from './shell-context-cache'

/**
 * Every Query entry goes, the shell's remembered session, Organization and features
 * with them (`shell-context-cache.ts`); a check still in flight is kept from being
 * remembered, and the person's other tabs are told to forget theirs. A sign-in, a
 * sign-out or a new Organization is a different answer to who is here and what they
 * may open.
 */
export function clearTenantCacheAfterTenantChange(
  queryClient: Pick<QueryClient, 'clear'>,
): void {
  queryClient.clear()
  shellContextForgotten(queryClient)
}

export async function clearTenantCacheBeforeNavigation(
  queryClient: Pick<QueryClient, 'clear'>,
  navigate: () => Promise<unknown> | unknown,
): Promise<void> {
  clearTenantCacheAfterTenantChange(queryClient)
  await navigate()
}

export async function clearTenantCacheAfterSessionEnd(
  queryClient: Pick<QueryClient, 'clear'>,
  endSession: () => Promise<unknown> | unknown,
  navigate: () => Promise<unknown> | unknown = () => undefined,
): Promise<void> {
  await endSession()
  clearTenantCacheAfterTenantChange(queryClient)
  await navigate()
}
