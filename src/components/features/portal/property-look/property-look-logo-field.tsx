// The logo's row in "Name and logo" (round-4 admin board 09): the logo on a dark
// swatch (it is a light logo, made for the dark page), and the buttons to upload,
// replace or remove it. Without a logo the section says what one is for; with one,
// guest pages and printed codes show it in place of the wordmark.
import { useState } from 'react'
import { ImagePlus } from 'lucide-react'
import type { PropertyLookLogo } from '#/contexts/portal/application/public-api'
import { Button } from '#/components/ui/button'
import type { PortalImageUploader } from '../portal-media/upload-portal-image'
import { PropertyLookLogoDialog } from './property-look-logo-dialog'
import { PropertyLookMediaActions } from './property-look-media-actions'
import { useRemoveMedia } from './use-remove-media'

export type PropertyLookLogoControls = Readonly<{
  propertyId: string
  propertyName: string
  logo: PropertyLookLogo | null
  /** An Account Admin with Portals writes on; anyone else sees the logo only. */
  canEdit: boolean
  /** Puts an uploaded logo on the look, or takes it off with null. A refusal is thrown. */
  onSave: (assetId: string | null) => Promise<void>
  upload?: PortalImageUploader
}>

const REMOVE_FAILED = 'The logo could not be taken off. Try again.'

export function PropertyLookLogoField({
  logo: controls,
}: Readonly<{ logo: PropertyLookLogoControls }>) {
  const [isOpen, setIsOpen] = useState(false)
  const { logo, canEdit } = controls
  const removal = useRemoveMedia(() => controls.onSave(null), REMOVE_FAILED)

  return (
    <div className="space-y-2">
      {logo ? (
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid h-16 min-w-32 place-items-center rounded-md bg-neutral-900 px-4">
            <img
              src={logo.url}
              alt={`${controls.propertyName} logo`}
              width={logo.width}
              height={logo.height}
              className="w-auto max-w-40 object-contain"
              style={{ maxHeight: 40 }}
            />
          </div>
          {canEdit ? (
            <div className="space-y-2">
              <PropertyLookMediaActions
                replaceLabel="Replace logo"
                removeLabel="Remove logo"
                isRemoving={removal.isRemoving}
                failure={removal.failure}
                onReplace={() => setIsOpen(true)}
                onRemove={() => void removal.remove()}
              />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            A light logo on a transparent background (PNG or WebP). It replaces the
            wordmark on every page and on printed codes.
          </p>
          {canEdit ? (
            <Button type="button" variant="outline" onClick={() => setIsOpen(true)}>
              <ImagePlus aria-hidden /> Upload logo
            </Button>
          ) : null}
        </div>
      )}
      {canEdit ? (
        <PropertyLookLogoDialog
          open={isOpen}
          onOpenChange={setIsOpen}
          propertyId={controls.propertyId}
          propertyName={controls.propertyName}
          hasLogo={logo !== null}
          onSave={async (assetId) => controls.onSave(assetId)}
          {...(controls.upload ? { upload: controls.upload } : {})}
        />
      ) : null}
    </div>
  )
}
