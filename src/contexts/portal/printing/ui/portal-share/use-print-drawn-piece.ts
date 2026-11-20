// A face and, where a back page is asked for, its back, laid out once for a page
// that gives them both the same bleed: an office sheet's, or a print shop's.
// Both pages draw the face in every place it stands, and the back after it, so
// they lay it out here and not each for itself.

import type { PrintBleed } from '#/shared/domain/portal-print-layers'
import { usePrintDrawnBack, type PrintDrawnBack } from './use-print-drawn-back'
import {
  usePrintDrawnFace,
  type PrintDrawnFace,
  type PrintDrawnFaceInput,
} from './use-print-drawn-face'

type Input = Readonly<{
  /** The face to lay out; the page gives it its bleed. */
  face: Omit<PrintDrawnFaceInput, 'bleed'>
  /** How far the Immersive art runs past the trim on this page; none for Paper. */
  bleed: PrintBleed | undefined
  /** The back is on show: without it nothing of it is laid out. */
  back: boolean
}>

export function usePrintDrawnPiece({ face, bleed, back }: Input): Readonly<{
  drawn: PrintDrawnFace
  drawnBack: PrintDrawnBack | null
}> {
  const drawn = usePrintDrawnFace({ ...face, bleed })
  const drawnBack = usePrintDrawnBack({
    face: face.face,
    look: face.look,
    front: drawn,
    enabled: back,
    bleed,
  })
  return { drawn, drawnBack }
}
