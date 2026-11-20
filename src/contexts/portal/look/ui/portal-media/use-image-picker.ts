// Choosing one picture in a dialog: the file, what the browser learned from
// decoding it, the checks it passes, and the sentence to show when it cannot be
// used. A file the server would refuse by type or weight is turned away here
// without decoding it; one that is merely too small or odd is kept, so the
// person sees which check it fails and chooses another.

import { useCallback, useState } from 'react'
import type { PortalMediaPurpose } from '#/shared/domain/portal-media'
import { checkImageFacts, type ImageCheck, type ImageFacts } from './image-checks'
import { readImageFacts } from './read-image-facts'
import { messageFor, validatePortalImageFile } from './upload-portal-image'

const UNREADABLE = 'We could not read that photo. Try another file.'

export type ChosenImage = Readonly<{
  file: File
  facts: ImageFacts
  /** A small copy to look at, as a data address (the page's CSP has no `blob:`). */
  previewUrl: string
}>

export function useImagePicker(purpose: PortalMediaPurpose) {
  const [chosen, setChosen] = useState<ChosenImage | null>(null)
  const [isReading, setIsReading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  /** Resolves whether the file was taken: the dialog starts afresh for a new picture only then. */
  const choose = useCallback(
    async (file: File): Promise<boolean> => {
      const refusal = validatePortalImageFile(file)
      if (refusal !== null) {
        setMessage(messageFor(purpose, refusal))
        return false
      }
      setMessage(null)
      setIsReading(true)
      // A logo is a light mark on a transparent background; a JPEG copy would turn it black.
      const read = await readImageFacts(file, { keepTransparency: purpose === 'logo' })
      setIsReading(false)
      if (!read.ok) {
        setMessage(messageFor(purpose, UNREADABLE))
        return false
      }
      setChosen({
        file,
        previewUrl: read.previewUrl,
        facts: {
          type: file.type,
          bytes: file.size,
          width: read.width,
          height: read.height,
        },
      })
      return true
    },
    [purpose],
  )

  const checks: readonly ImageCheck[] = chosen
    ? checkImageFacts(purpose, chosen.facts)
    : []
  return { chosen, checks, isReading, message, setMessage, choose }
}
