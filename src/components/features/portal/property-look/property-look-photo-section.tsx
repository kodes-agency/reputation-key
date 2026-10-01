// Photo (board 09): what fills the top of every page and tints the colour field.
// Uploading and the focal point arrive with the media controls (slice 42c2),
// which mount in `slot`; until then the section says plainly that pages use the
// colour field, and offers the preview without a photo.
import type { ReactNode } from 'react'
import { ImageOff } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { PropertyLookSection } from './property-look-section'

type Props = Readonly<{
  /** The photo, its focal point and the upload controls. */
  slot?: ReactNode
  onPreviewWithoutPhoto?: () => void
}>

export function PropertyLookPhotoSection({ slot = null, onPreviewWithoutPhoto }: Props) {
  return (
    <PropertyLookSection
      isFirst
      title="Photo"
      hint="Fills the top of every page and tints the colour field."
    >
      {slot}
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
        <ImageOff className="size-4 shrink-0" aria-hidden />
        <span>No photo? Pages use the colour field.</span>
        {onPreviewWithoutPhoto ? (
          <Button
            type="button"
            variant="link"
            className="h-auto p-0 text-sm"
            onClick={onPreviewWithoutPhoto}
          >
            Preview without a photo
          </Button>
        ) : null}
      </p>
    </PropertyLookSection>
  )
}
