// What the Photo section and the logo field are handed: the page's photograph and
// logo, the writes behind their buttons, and the phone the photograph dialog draws
// beside the picture. Put together here so the page only places them.

import type { PropertyLookMedia } from '#/contexts/portal/application/public-api'
import type { OfferedGuestLocale } from '#/shared/domain/guest-locale'
import type { PortalImageUploader } from '../portal-media/upload-portal-image'
import { PropertyLookPhone } from './property-look-phone'
import type { PropertyLookLogoControls } from './property-look-logo-field'
import type { PropertyLookPhotoControls } from './property-look-photo-section'
import type { LookDraft } from './property-look-rules'
import type { PhotoDescriptions } from './property-photo-rules'
import {
  usePropertyLookMedia,
  type PropertyLookMediaSaves,
} from './use-property-look-media'
import type { PreviewPortal, PropertyLookPreviewData } from './use-property-look-preview'

/** The scale of the phone beside the photograph dialog's photograph. */
const DIALOG_PHONE_SCALE = 0.5

type Input = Readonly<{
  propertyId: string
  propertyName: string
  /** An Account Admin with Portals writes on. */
  canEdit: boolean
  savedMedia: PropertyLookMedia
  saves: PropertyLookMediaSaves
  /** What the Property has written to describe the photograph, by language. */
  descriptions: PhotoDescriptions
  /** The languages offered by default; each gets a description. */
  locales: readonly OfferedGuestLocale[]
  /** Sends an image to the media endpoint; the real upload when left out. */
  uploadImage: PortalImageUploader | undefined
  preview: Readonly<{
    portal: PreviewPortal | null
    data: PropertyLookPreviewData
    draft: LookDraft
  }>
}>

export function usePropertyLookMediaControls({
  propertyId,
  propertyName,
  canEdit,
  savedMedia,
  saves,
  descriptions,
  locales,
  uploadImage,
  preview,
}: Input) {
  const { media, moveFocal, saveHero, saveLogo } = usePropertyLookMedia(
    propertyId,
    savedMedia,
    saves,
  )
  const upload = uploadImage ? { upload: uploadImage } : {}
  const photo: PropertyLookPhotoControls = {
    propertyId,
    propertyName,
    hero: media.hero,
    locales,
    descriptions,
    canEdit,
    onFocalChange: moveFocal,
    onSave: saveHero,
    onRemove: () => saveHero({ assetId: null }),
    renderPhone: (hero) => (
      <PropertyLookPhone
        portal={preview.portal}
        data={preview.data}
        draft={preview.draft}
        showPhoto
        media={{ hero, logo: media.logo }}
        scale={DIALOG_PHONE_SCALE}
      />
    ),
    ...upload,
  }
  const logo: PropertyLookLogoControls = {
    propertyId,
    propertyName,
    logo: media.logo,
    canEdit,
    onSave: saveLogo,
    ...upload,
  }
  return { media, photo, logo }
}
