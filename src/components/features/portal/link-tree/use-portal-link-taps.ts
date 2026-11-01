import { useQuery } from '@tanstack/react-query'
import type { getPortalLinkTapsFn } from '#/contexts/reporting/server/portal-analytics'
import { portalKeys } from '#/shared/queries/query-keys'

/**
 * Taps per link for the editor's rows. A draft has none to show, and a failed or
 * denied read draws nothing: this figure must never disturb editing.
 */
export function usePortalLinkTaps(
  input: Readonly<{
    getLinkTaps?: typeof getPortalLinkTapsFn
    pageIsLive: boolean
    propertyId: string
    portalId: string
  }>,
): Readonly<Record<string, number>> | undefined {
  const { getLinkTaps, pageIsLive, propertyId, portalId } = input
  const query = useQuery({
    queryKey: portalKeys.linkTaps(propertyId, portalId),
    queryFn: () => getLinkTaps!({ data: { propertyId, portalId } }),
    enabled: pageIsLive && getLinkTaps !== undefined,
    retry: false,
  })
  return pageIsLive && !query.isError ? query.data?.taps : undefined
}
