// Photo (round-4 admin board 09): what fills the top of every page and tints the
// colour field. The photograph is shown with the circle that says what every
// page must keep in view, which is dragged (or moved with the arrow keys) right
// here and autosaves; "Replace photo" opens board 14's dialog, which also sets
// the focal point of a new photograph, describes it for screen readers and asks
// for the permission to use it.
import { useState, type ReactNode } from 'react'
import { ImageOff, ImagePlus, Upload } from 'lucide-react'
import type { PropertyLookHero } from '#/contexts/portal/application/public-api'
import { Button } from '#/components/ui/button'
import type { OfferedGuestLocale } from '#/shared/domain/guest-locale'
import type { PortalImageUploader } from '../portal-media/upload-portal-image'
import { FocalPointPicker } from './focal-point-picker'
import type { FocalPoint } from './focal-point'
import { PropertyLookPhotoDialog } from './property-look-photo-dialog'
import type { PreviewMedia } from './property-look-preview-brand'
import { refusalOf } from './property-look-rules'
import { PropertyLookSection } from './property-look-section'
import type { PhotoDescriptions } from './property-photo-rules'
import type { PhotoDialogInput } from './use-photo-dialog'

export type PropertyLookPhotoControls = Readonly<{
  propertyId: string
  propertyName: string
  /** The photograph the Property has now. */
  hero: PropertyLookHero | null
  /** Languages offered by default; each gets a description. */
  locales: readonly OfferedGuestLocale[]
  descriptions: PhotoDescriptions
  /** An Account Admin with Portals writes on; anyone else sees the photograph only. */
  canEdit: boolean
  onFocalChange: (focal: FocalPoint) => void
  onSave: PhotoDialogInput['onSave']
  /** Takes the photograph off. A refusal is thrown. */
  onRemove: () => Promise<void>
  /** The phone beside the dialog's photograph. */
  renderPhone: (hero: NonNullable<PreviewMedia['hero']> | null) => ReactNode
  upload?: PortalImageUploader
}>

type Props = Readonly<{
  photo: PropertyLookPhotoControls
  onPreviewWithoutPhoto?: () => void
}>

const REMOVE_FAILED = 'The photo could not be taken off. Try again.'

export function PropertyLookPhotoSection({ photo, onPreviewWithoutPhoto }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const { hero, canEdit } = photo
  const primaryDescription = photo.locales[0]
    ? photo.descriptions[photo.locales[0]]
    : undefined

  const remove = async () => {
    setIsRemoving(true)
    setFailure(null)
    try {
      await photo.onRemove()
    } catch (error) {
      setFailure(refusalOf(error) ?? REMOVE_FAILED)
    } finally {
      setIsRemoving(false)
    }
  }

  return (
    <PropertyLookSection
      isFirst
      title="Photo"
      hint="Fills the top of every page and tints the colour field."
    >
      {hero ? (
        <div className="flex flex-wrap items-start gap-4">
          <FocalPointPicker
            src={hero.url}
            width={hero.width}
            height={hero.height}
            focal={{ x: hero.focalX, y: hero.focalY }}
            onChange={photo.onFocalChange}
            disabled={!canEdit}
            alt={primaryDescription ?? ''}
            maxHeightRem={7}
            maxWidthRem={10}
            className="shrink-0"
          />
          {canEdit ? (
            <div className="flex min-w-0 flex-1 flex-col items-start gap-2.5">
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => setIsOpen(true)}>
                  <Upload aria-hidden /> Replace photo
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={isRemoving}
                  onClick={() => void remove()}
                >
                  Remove photo
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Drag the circle onto what guests should always see. Every page crops
                around it.
              </p>
            </div>
          ) : null}
        </div>
      ) : canEdit ? (
        <Button type="button" variant="outline" onClick={() => setIsOpen(true)}>
          <ImagePlus aria-hidden /> Add a photo
        </Button>
      ) : null}
      <p role="alert" className="text-sm text-negative empty:hidden">
        {failure}
      </p>
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
        <ImageOff className="size-4 shrink-0" aria-hidden />
        <span>No photo? Pages use the colour field.</span>
        {onPreviewWithoutPhoto && hero ? (
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
      {canEdit ? (
        <PropertyLookPhotoDialog
          open={isOpen}
          onOpenChange={setIsOpen}
          propertyId={photo.propertyId}
          propertyName={photo.propertyName}
          hero={hero}
          locales={photo.locales}
          saved={photo.descriptions}
          onSave={photo.onSave}
          renderPhone={photo.renderPhone}
          {...(photo.upload ? { upload: photo.upload } : {})}
        />
      ) : null}
    </PropertyLookSection>
  )
}
