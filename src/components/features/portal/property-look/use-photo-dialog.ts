// The photograph dialog's state (round-4 admin board 14): the picture being
// chosen, where its focal point is, the descriptions, the confirmation, and the
// two steps "Use photo" takes (send the file, then put it on the look). Held
// apart from the dialog so the dialog only draws it.
//
// A file sent is remembered, so when putting it on the look fails and the person
// presses the button again the same bytes are not sent twice.

import { useRef, useState } from 'react'
import type { PropertyLookHero } from '#/contexts/portal/application/public-api'
import type { OfferedGuestLocale } from '#/shared/domain/guest-locale'
import { allImageChecksPass } from '../portal-media/image-checks'
import { useImagePicker } from '../portal-media/use-image-picker'
import {
  uploadPortalImage,
  type PortalImageUploader,
} from '../portal-media/upload-portal-image'
import { CENTRE_FOCAL, type FocalPoint } from './focal-point'
import {
  canUsePhoto,
  changedDescriptions,
  descriptionProblem,
  overlongDescriptionLocales,
  focalMoved,
  type PhotoDescriptions,
} from './property-photo-rules'
import { refusalOf } from './property-look-rules'
import type { PropertyHeroWrite } from './use-property-look-media'

const LEFT_OUT_WRITE = 'The changes could not be saved. Try again.'
const SENT_BUT_NOT_PUT_ON =
  'The photo was uploaded, but it could not be put on the look. Try again.'

export type PhotoDialogInput = Readonly<{
  propertyId: string
  /** The photograph the Property has now. */
  hero: PropertyLookHero | null
  locales: readonly OfferedGuestLocale[]
  /** What the Property has written, by language. */
  saved: PhotoDescriptions
  onSave: (write: Omit<PropertyHeroWrite, 'propertyId'>) => Promise<void>
  onBusyChange: (isBusy: boolean) => void
  onClose: () => void
  upload?: PortalImageUploader
}>

export function usePhotoDialog({
  propertyId,
  hero,
  locales,
  saved,
  onSave,
  onBusyChange,
  onClose,
  upload = (input, file) => uploadPortalImage(input, file),
}: PhotoDialogInput) {
  const picker = useImagePicker('hero')
  const savedFocal: FocalPoint | null = hero ? { x: hero.focalX, y: hero.focalY } : null
  const [focal, setFocal] = useState<FocalPoint>(savedFocal ?? CENTRE_FOCAL)
  const [descriptions, setDescriptions] = useState<PhotoDescriptions>(saved)
  const [isConfirmed, setIsConfirmed] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const sent = useRef<{ file: File; assetId: string } | null>(null)

  const { chosen } = picker
  const photo = chosen
    ? { url: chosen.previewUrl, width: chosen.facts.width, height: chosen.facts.height }
    : hero
      ? { url: hero.url, width: hero.width, height: hero.height }
      : null
  const isFileUsable = chosen !== null && allImageChecksPass(picker.checks)
  const problem = descriptionProblem(descriptions)
  const overlong = overlongDescriptionLocales(descriptions)
  const changes = changedDescriptions(locales, descriptions, saved)

  const canSubmit = canUsePhoto({
    hasPhoto: hero !== null,
    hasFile: chosen !== null,
    isFileUsable,
    isRightsConfirmed: isConfirmed,
    isFocalChanged: focalMoved(savedFocal, focal),
    isDescriptionChanged: changes.length > 0,
    isDescriptionValid: problem === null,
    isBusy,
  })

  /** A new picture starts afresh: its focal point is the middle and the old description is not about it. */
  const choose = async (file: File) => {
    if (!(await picker.choose(file))) return
    setFocal(CENTRE_FOCAL)
    setDescriptions({})
    setIsConfirmed(false)
    setFailure(null)
    sent.current = null
  }

  async function sendChosen(): Promise<string | null> {
    if (!chosen) return hero?.assetId ?? null
    if (sent.current?.file === chosen.file) return sent.current.assetId
    const result = await upload(
      { propertyId, purpose: 'hero', rightsConfirmed: isConfirmed },
      chosen.file,
    )
    if (!result.ok) {
      setFailure(result.message)
      return null
    }
    sent.current = { file: chosen.file, assetId: result.assetId }
    return result.assetId
  }

  const submit = async () => {
    if (!canSubmit) return
    setIsBusy(true)
    onBusyChange(true)
    setFailure(null)
    const assetId = await sendChosen()
    if (assetId === null) {
      setIsBusy(false)
      onBusyChange(false)
      return
    }
    try {
      await onSave({
        assetId,
        focalX: focal.x,
        focalY: focal.y,
        ...(changes.length === 0 ? {} : { altTexts: changes }),
      })
      onClose()
    } catch (error) {
      setFailure(refusalOf(error) ?? (chosen ? SENT_BUT_NOT_PUT_ON : LEFT_OUT_WRITE))
      setIsBusy(false)
      onBusyChange(false)
    }
  }

  return {
    picker,
    photo,
    focal,
    setFocal,
    descriptions,
    setDescriptions,
    problem,
    /** The languages whose description is over the limit. */
    overlong,
    isConfirmed,
    setIsConfirmed,
    isBusy,
    canSubmit,
    /** The first thing to tell the person: a refusal of the file, or of the write. */
    message: failure ?? picker.message,
    choose,
    submit,
  }
}
