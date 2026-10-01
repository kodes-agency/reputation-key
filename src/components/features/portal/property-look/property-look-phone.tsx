// The portal's arrival page in a phone, with the draft look laid over it (board
// 9) and, in the photograph dialog (board 14), the photograph being chosen. A
// picture and nothing more: it reads nothing and writes nothing.

import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { GUEST_LOCALE_METADATA } from '#/shared/domain/guest-locale'
import { PHONE_SCALE } from '../portal-preview/portal-preview-stage'
import { ARRIVAL_STATE } from '../portal-preview/portal-preview-states'
import { PreviewGuestPage } from '../portal-preview/preview-guest-page'
import { PreviewPhone, phoneFrameSize } from '../portal-preview/preview-phone'
import { previewBrandOf, type PreviewMedia } from './property-look-preview-brand'
import type { LookDraft } from './property-look-rules'
import type { PreviewPortal, PropertyLookPreviewData } from './use-property-look-preview'

type Props = Readonly<{
  portal: PreviewPortal | null
  data: PropertyLookPreviewData
  draft: LookDraft
  showPhoto: boolean
  media: PreviewMedia
  /** The phone's scale; the page's own unless the dialog wants a smaller one. */
  scale?: number
}>

export function PropertyLookPhone({
  portal,
  data,
  draft,
  showPhoto,
  media,
  scale = PHONE_SCALE,
}: Props) {
  const { preview, experience, copy, locale, isPending, isError, refetch } = data
  if (portal === null) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Make a portal to see the look on a page.
      </p>
    )
  }
  if (isError) {
    return (
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
    )
  }
  if (isPending || !preview || !experience || !copy.data) {
    return (
      <div className="flex flex-col items-center gap-3" aria-busy="true">
        <Skeleton className="rounded-[2.2rem]" style={phoneFrameSize(scale)} />
        <span className="sr-only">Loading preview…</span>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center gap-3">
      <PreviewPhone
        scale={scale}
        label={`Preview of the guest page: ${portal.name}, arrival`}
      >
        <div inert>
          <PreviewGuestPage
            experience={{
              ...experience,
              brand: previewBrandOf(experience.brand, draft, showPhoto, media),
            }}
            copy={copy.data}
            locale={locale}
            hasLanguageChip={preview.locales.length > 1}
            state={ARRIVAL_STATE}
          />
        </div>
      </PreviewPhone>
      <p className="text-center text-sm text-muted-foreground" aria-live="polite">
        Draft look · {portal.name} · Arrival · {GUEST_LOCALE_METADATA[locale].englishName}
      </p>
    </div>
  )
}
