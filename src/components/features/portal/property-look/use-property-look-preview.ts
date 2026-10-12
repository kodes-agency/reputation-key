// The chosen portal's draft page, read for the Property look page's phone and the
// photograph dialog's phone: the same server function and the same cache entry as
// the portal editor's preview, so the two phones and the editor share one read.

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { portalKeys } from '#/shared/queries/query-keys'
import type { PortalPreviewReader } from '../portal-preview/portal-preview-pane'
import { usePreviewCopy } from '../portal-preview/use-preview-copy'
import { hasFailed, isRetrying } from '#/components/hooks/is-retrying'

export type PreviewPortal = Readonly<{ id: string; name: string }>

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
    placeholderData: keepPreviousData,
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
    refetch: query.refetch,
  }
}

export type PropertyLookPreviewData = ReturnType<typeof usePropertyLookPreview>
