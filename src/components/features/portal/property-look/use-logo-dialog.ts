// The logo dialog's state: the picture being chosen, the confirmation, and the two
// steps "Use logo" takes (send the file, then put it on the look). A file already
// sent is not sent twice when putting it on the look fails and the button is
// pressed again.

import { useRef, useState } from 'react'
import { allImageChecksPass } from '../portal-media/image-checks'
import { useImagePicker } from '../portal-media/use-image-picker'
import {
  uploadPortalImage,
  type PortalImageUploader,
} from '../portal-media/upload-portal-image'
import { refusalOf } from './property-look-rules'

const SENT_BUT_NOT_PUT_ON =
  'The logo was uploaded, but it could not be put on the look. Try again.'

export type LogoDialogInput = Readonly<{
  propertyId: string
  /** Puts the uploaded logo on the look. A refusal is thrown. */
  onSave: (assetId: string) => Promise<void>
  onBusyChange: (isBusy: boolean) => void
  onClose: () => void
  upload?: PortalImageUploader
}>

export function useLogoDialog({
  propertyId,
  onSave,
  onBusyChange,
  onClose,
  upload = (input, file) => uploadPortalImage(input, file),
}: LogoDialogInput) {
  const picker = useImagePicker('logo')
  const [isConfirmed, setIsConfirmed] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const sent = useRef<{ file: File; assetId: string } | null>(null)

  const { chosen } = picker
  const canSubmit =
    chosen !== null && allImageChecksPass(picker.checks) && isConfirmed && !isBusy

  const choose = async (file: File) => {
    if (!(await picker.choose(file))) return
    setIsConfirmed(false)
    setFailure(null)
    sent.current = null
  }

  const stop = (message: string) => {
    setFailure(message)
    setIsBusy(false)
    onBusyChange(false)
  }

  const submit = async () => {
    if (!chosen || !canSubmit) return
    setIsBusy(true)
    onBusyChange(true)
    setFailure(null)
    let assetId = sent.current?.file === chosen.file ? sent.current.assetId : null
    if (assetId === null) {
      const result = await upload(
        { propertyId, purpose: 'logo', rightsConfirmed: isConfirmed },
        chosen.file,
      )
      if (!result.ok) {
        stop(result.message)
        return
      }
      sent.current = { file: chosen.file, assetId: result.assetId }
      assetId = result.assetId
    }
    try {
      await onSave(assetId)
      onClose()
    } catch (error) {
      stop(refusalOf(error) ?? SENT_BUT_NOT_PUT_ON)
    }
  }

  return {
    picker,
    isConfirmed,
    setIsConfirmed,
    isBusy,
    canSubmit,
    message: failure ?? picker.message,
    choose,
    submit,
  }
}
