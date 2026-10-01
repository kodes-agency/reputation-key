// The preview beside the form (board 09): the chosen portal's arrival page, in
// its own primary language, with the draft look laid over it, with and without
// a photo. It reads the portal's draft through the same server function (and
// cache entry) as the portal editor's preview, and writes nothing.
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { SegmentedControl } from '#/components/ui/segmented-control'
import { GUEST_FONT_STYLESHEET } from '#/shared/font-sets'
import { GUEST_LOCALE_METADATA } from '#/shared/domain/guest-locale'
import { portalKeys } from '#/shared/queries/query-keys'
import { PHONE_SCALE } from '../portal-preview/portal-preview-stage'
import { ARRIVAL_STATE } from '../portal-preview/portal-preview-states'
import { PreviewGuestPage } from '../portal-preview/preview-guest-page'
import { PreviewPhone, phoneFrameSize } from '../portal-preview/preview-phone'
import type { PortalPreviewReader } from '../portal-preview/portal-preview-pane'
import { usePreviewCopy } from '../portal-preview/use-preview-copy'
import { previewBrandOf } from './property-look-preview-brand'
import type { LookDraft } from './property-look-rules'

type Props = Readonly<{
  /** The portal to draw; null when the Property has none. */
  portal: Readonly<{ id: string; name: string }> | null
  getPortalPreview: PortalPreviewReader
  draft: LookDraft
  showPhoto: boolean
  onShowPhotoChange: (showPhoto: boolean) => void
}>

const PHOTO_OPTIONS = [
  { value: 'with', label: 'With photo' },
  { value: 'without', label: 'Without photo' },
] as const

export function PropertyLookPreview({
  portal,
  getPortalPreview,
  draft,
  showPhoto,
  onShowPhotoChange,
}: Props) {
  const portalId = portal?.id ?? ''
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: portalKeys.preview(portalId, 'draft'),
    queryFn: () => getPortalPreview({ data: { portalId, source: 'draft' } }),
    enabled: portal !== null,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })
  const preview = data?.status === 'ready' ? data.preview : null
  const locale = preview?.primaryLocale ?? 'en'
  const experience = preview?.experiences[locale]
  const copy = usePreviewCopy(locale)
  const hasPhoto = experience?.brand.hero != null

  return (
    <section aria-labelledby="property-look-preview-heading" className="space-y-3">
      <link rel="stylesheet" href={GUEST_FONT_STYLESHEET} precedence="default" />
      <h2 id="property-look-preview-heading" className="sr-only">
        Preview
      </h2>
      <div className="flex justify-center">
        <SegmentedControl
          aria-label="Preview with or without a photo"
          value={showPhoto && hasPhoto ? 'with' : 'without'}
          onValueChange={(value) => onShowPhotoChange(value === 'with')}
          options={PHOTO_OPTIONS.map((option) => ({
            ...option,
            disabled: option.value === 'with' && !hasPhoto,
          }))}
        />
      </div>
      {portal === null ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Make a portal to see the look on a page.
        </p>
      ) : isError || copy.isError ? (
        <div role="alert" className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm font-medium">The preview couldn’t be loaded</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => void refetch()}
          >
            Try again
          </Button>
        </div>
      ) : isPending || !preview || !experience || !copy.data ? (
        <div className="flex flex-col items-center gap-3" aria-busy="true">
          <Skeleton className="rounded-[2.2rem]" style={phoneFrameSize(PHONE_SCALE)} />
          <span className="sr-only">Loading preview…</span>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <PreviewPhone
            scale={PHONE_SCALE}
            label={`Preview of the guest page: ${portal.name}, arrival`}
          >
            <div inert>
              <PreviewGuestPage
                experience={{
                  ...experience,
                  brand: previewBrandOf(experience.brand, draft, showPhoto),
                }}
                copy={copy.data}
                locale={locale}
                hasLanguageChip={preview.locales.length > 1}
                state={ARRIVAL_STATE}
              />
            </div>
          </PreviewPhone>
          <p className="text-center text-sm text-muted-foreground" aria-live="polite">
            Draft look · {portal.name} · Arrival ·{' '}
            {GUEST_LOCALE_METADATA[locale].englishName}
          </p>
        </div>
      )}
    </section>
  )
}
