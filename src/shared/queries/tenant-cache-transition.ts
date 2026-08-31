import type { QueryClient } from '@tanstack/react-query'

export function clearTenantCacheAfterTenantChange(
  queryClient: Pick<QueryClient, 'clear'>,
): void {
  queryClient.clear()
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
