// What the review page draws its phones from: the saved draft as publishing
// would write it, in one language, with that language's guest wording. It is
// the same read, and the same cache entry, as the editor's Draft preview, so a
// manager who has just come from the editor sees the page at once.

import { useQuery } from '@tanstack/react-query'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import { portalKeys } from '#/shared/queries/query-keys'
import type { GuestPortalCopyV2 } from '#/components/features/guest'
import type {
  PortalPreview,
  PortalPreviewExperience,
  PortalPreviewUnavailableReason,
} from '#/contexts/portal/application/public-api'
import type { PortalPreviewReader } from '../portal-preview/portal-preview-pane'
import { usePreviewCopy } from '../portal-preview/use-preview-copy'
import { hasFailed, isRetrying } from '#/components/hooks/is-retrying'

export type ReviewPreviewData =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'error'; retry: () => void; retrying: boolean }>
  | Readonly<{ status: 'unavailable'; reason: PortalPreviewUnavailableReason }>
  | Readonly<{
      status: 'ready'
      preview: PortalPreview
      experience: PortalPreviewExperience
      copy: GuestPortalCopyV2
      /** The language drawn: the one chosen, else the portal's own. */
      locale: GuestLocale
    }>

export function useReviewPreview(
  portalId: string,
  getPortalPreview: PortalPreviewReader,
  chosenLocale: GuestLocale | null,
): ReviewPreviewData {
  const read = useQuery({
    queryKey: portalKeys.preview(portalId, 'draft'),
    queryFn: () => getPortalPreview({ data: { portalId, source: 'draft' } }),
    staleTime: 30_000,
  })
  const preview = read.data?.status === 'ready' ? read.data.preview : null
  // A language the draft no longer offers falls back to its primary one.
  const locale =
    chosenLocale !== null && preview?.locales.includes(chosenLocale)
      ? chosenLocale
      : (preview?.primaryLocale ?? 'en')
  const copy = usePreviewCopy(locale)

  if (hasFailed(read) || hasFailed(copy)) {
    return {
      status: 'error',
      retry: () => {
        if (read.isError) void read.refetch()
        if (copy.isError) void copy.refetch()
      },
      retrying: isRetrying(read, copy),
    }
  }
  if (read.data?.status === 'unavailable') {
    return { status: 'unavailable', reason: read.data.reason }
  }
  const experience = preview?.experiences[locale]
  if (preview === null || experience === undefined || copy.data === undefined) {
    return { status: 'loading' }
  }
  return { status: 'ready', preview, experience, copy: copy.data, locale }
}
