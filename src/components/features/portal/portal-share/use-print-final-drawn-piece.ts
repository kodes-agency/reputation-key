// A face and, where a back page is asked for, its back, laid out once for a page
// that gives them both the same bleed: an office sheet's, or a print shop's.
// Both pages draw the face in every place it stands, and the back after it, so
// they lay it out here and not each for itself.

import type { PrintFinalBleed } from '#/shared/domain/portal-print-final-layers'
import {
  usePrintFinalDrawnBack,
  type PrintFinalDrawnBack,
} from './use-print-final-drawn-back'
import {
  usePrintFinalDrawnFace,
  type PrintFinalDrawnFace,
  type PrintFinalFaceInput,
} from './use-print-final-drawn-face'

type Input = Readonly<{
  /** The face to lay out; the page gives it its bleed. */
  face: Omit<PrintFinalFaceInput, 'bleed'>
  /** How far the Immersive art runs past the trim on this page; none for Paper. */
  bleed: PrintFinalBleed | undefined
  /** The back is on show: without it nothing of it is laid out. */
  back: boolean
}>

export function usePrintFinalDrawnPiece({ face, bleed, back }: Input): Readonly<{
  drawn: PrintFinalDrawnFace
  drawnBack: PrintFinalDrawnBack | null
}> {
  const drawn = usePrintFinalDrawnFace({ ...face, bleed })
  const drawnBack = usePrintFinalDrawnBack({
    face: face.face,
    look: face.look,
    front: drawn,
    enabled: back,
    bleed,
  })
  return { drawn, drawnBack }
}
