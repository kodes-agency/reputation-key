import { useQuery } from '@tanstack/react-query'
import { useHydrated } from '#/components/hooks/use-hydrated'
import type { PortalLinkTapsRead } from '../../contracts'
import { portalKeys } from '#/shared/queries/query-keys'

/**
 * Taps per link for the editor's rows. A draft has none to show, and a failed or
 * denied read draws nothing: this figure must never disturb editing.
 */
export function usePortalLinkTaps(
  input: Readonly<{
    getLinkTaps?: PortalLinkTapsRead
    pageIsLive: boolean
    propertyId: string
    portalId: string
  }>,
): Readonly<Record<string, number>> | undefined {
  const { getLinkTaps, pageIsLive, propertyId, portalId } = input
  const hydrated = useHydrated()
  const query = useQuery({
    queryKey: portalKeys.linkTaps(propertyId, portalId),
    queryFn: () => getLinkTaps!({ data: { propertyId, portalId } }),
    enabled: pageIsLive && getLinkTaps !== undefined,
    retry: false,
  })
  // The server drew no figures; the first browser render draws none either.
  return hydrated && pageIsLive && !query.isError ? query.data?.taps : undefined
}
