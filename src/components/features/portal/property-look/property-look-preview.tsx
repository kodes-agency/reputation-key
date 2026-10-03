// The preview beside the form (board 09): the chosen portal's arrival page, in
// its own primary language, with the draft look laid over it, with and without
// a photo. It draws the portal's draft as the page read it (the same server
// function and cache entry as the portal editor's preview) and writes nothing. The photograph
// and logo are the page's own (`media`): a photograph just put on, or a focal
// point still being dragged, shows at once, before any read has caught up.
import { SegmentedControl } from '#/components/ui/segmented-control'
import { GUEST_FONT_STYLESHEET } from '#/shared/font-sets'
import { PropertyLookPhone } from './property-look-phone'
import type { PreviewMedia } from './property-look-preview-brand'
import type { LookDraft } from './property-look-rules'
import type { PreviewPortal, PropertyLookPreviewData } from './use-property-look-preview'

type Props = Readonly<{
  /** The portal to draw; null when the Property has none. */
  portal: PreviewPortal | null
  data: PropertyLookPreviewData
  draft: LookDraft
  media: PreviewMedia
  showPhoto: boolean
  onShowPhotoChange: (showPhoto: boolean) => void
}>

const PHOTO_OPTIONS = [
  { value: 'with', label: 'With photo' },
  { value: 'without', label: 'Without photo' },
] as const

export function PropertyLookPreview({
  portal,
  data,
  draft,
  media,
  showPhoto,
  onShowPhotoChange,
}: Props) {
  const hasPhoto = media.hero !== null
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
      <PropertyLookPhone
        portal={portal}
        data={data}
        draft={draft}
        showPhoto={showPhoto}
        media={media}
      />
    </section>
  )
}
