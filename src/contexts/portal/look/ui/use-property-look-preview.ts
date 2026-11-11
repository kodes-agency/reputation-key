// The chosen portal's draft page, read for the Property look page's phone and the
// photograph dialog's phone: the same server function and the same cache entry as
// the portal editor's preview, so the two phones and the editor share one read.

import { useQuery } from '@tanstack/react-query'
import type { PortalLookSources } from '#/contexts/portal/application/portal-management-contracts'
import { portalKeys } from '#/shared/queries/query-keys'
import type { PortalPreviewReader } from '#/components/features/portal/portal-preview/portal-preview-pane'
import { usePreviewCopy } from '#/components/features/portal/portal-preview/use-preview-copy'
import { hasFailed, isRetrying } from '#/components/hooks/is-retrying'

export type PreviewPortal = Readonly<{
  id: string
  name: string
  /** Which parts of its look are the portal's own; the draft look is laid over the rest. Absent: none. */
  sources?: PortalLookSources
}>

export function usePropertyLookPreview(
  portal: PreviewPortal | null,
  getPortalPreview: PortalPreviewReader,
) {
  const portalId = portal?.id ?? ''
  const query = useQuery({
    queryKey: portalKeys.preview(portalId, 'draft'),
    queryFn: () => getPortalPreview({ data: { portalId, source: 'draft' } }),
    enabled: portal !== null,
    staleTime: 30_000,
  })
  const preview = query.data?.status === 'ready' ? query.data.preview : null
  const locale = preview?.primaryLocale ?? 'en'
  const experience = preview?.experiences[locale]
  const copy = usePreviewCopy(locale)
  return {
    preview,
    locale,
    experience,
    copy,
    isPending: query.isPending,
    isError: hasFailed(query) || hasFailed(copy),
    isRetrying: isRetrying(query, copy),
    /** Reads again what failed: the page, the wording, or both. */
    refetch: () =>
      Promise.all([
        ...(hasFailed(query) ? [query.refetch()] : []),
        ...(hasFailed(copy) ? [copy.refetch()] : []),
      ]),
  }
}

export type PropertyLookPreviewData = ReturnType<typeof usePropertyLookPreview>
