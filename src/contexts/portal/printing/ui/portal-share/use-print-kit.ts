import { useQuery } from '@tanstack/react-query'
import { hasFailed, isRetrying } from '#/components/hooks/is-retrying'
import { portalKeys } from '#/shared/queries/query-keys'
import type { PortalPrintKitReader } from './portal-print-kit-types'

export function usePrintKit({
  portalId,
  read,
  enabled,
}: Readonly<{ portalId: string; read: PortalPrintKitReader; enabled: boolean }>) {
  const query = useQuery({
    queryKey: portalKeys.printKit(portalId),
    queryFn: () => read({ data: { portalId } }),
    enabled,
    staleTime: 30_000,
  })
  return {
    view: query.data ?? null,
    isPending: query.isPending && enabled,
    isError: hasFailed(query),
    error: query.error,
    isRetrying: isRetrying(query),
    retry: () => void query.refetch(),
    refresh: () => void query.refetch(),
  }
}
