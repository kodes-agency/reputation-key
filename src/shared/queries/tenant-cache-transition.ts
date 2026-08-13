import type { QueryClient } from '@tanstack/react-query'

export async function clearTenantCacheBeforeNavigation(
  queryClient: Pick<QueryClient, 'clear'>,
  navigate: () => Promise<unknown> | unknown,
): Promise<void> {
  queryClient.clear()
  await navigate()
}
