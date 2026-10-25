// A final face as the Share tab's preview draws it, laid out once: Paper by the
// planner the PDF uses (`previewFinalFaceLayout`), Immersive by its painter too
// (`previewFinalImmersiveFace`), from the browser's decode of the photo and the
// logo. Laying an Immersive face out reads every word against the photo, so the
// preview does it once and draws the result wherever it is needed: the face on
// its own and every cell of the sheet (`bleed` gives the sheet's own copy, its art
// run into the bleed).

import { useMemo } from 'react'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type { PrintTextBlock } from '#/shared/domain/portal-print-kit'
import type { PrintFinalFace } from '#/shared/domain/portal-print-final'
import type { PrintFinalTile } from '#/shared/domain/portal-print-final-code'
import { printFinalPaperColours } from '#/shared/domain/portal-print-final-colours'
import type { PrintFinalFaceLayout } from '#/shared/domain/portal-print-final-face'
import type { PrintFinalFraming } from '#/shared/domain/portal-print-final-framing'
import type { PrintFinalImmersiveFace } from '#/shared/domain/portal-print-final-immersive-face'
import type { PrintFinalBleed } from '#/shared/domain/portal-print-final-layers'
import { paperPrintKitPalette } from '#/shared/domain/portal-print-kit-palette'
import {
  previewFinalFaceLayout,
  previewFinalImmersiveFace,
} from './print-final-face-layout'
import {
  usePreviewFinalLogo,
  usePreviewFinalPhoto,
  type PreviewFinalPhoto,
} from './use-print-final-pictures'

export type PrintFinalFaceInput = Readonly<{
  face: PrintFinalFace
  blocks: readonly PrintTextBlock[]
  look: PortalPrintKitView['look']
  tile: PrintFinalTile
  /** How the manager framed the photo for this piece and orientation (Immersive). */
  framing?: PrintFinalFraming
  /** How far the art runs past the trim, on a sheet; none on its own. */
  bleed?: PrintFinalBleed
}>

export type PrintFinalDrawnFace =
  | Readonly<{
      look: 'paper'
      layout: PrintFinalFaceLayout
      colours: ReturnType<typeof printFinalPaperColours>
    }>
  | Readonly<{
      look: 'immersive'
      laid: PrintFinalImmersiveFace
      /** The decoded photo, null with none; `waiting` while it decodes. */
      photo: PreviewFinalPhoto | null
      waiting: boolean
    }>

export function usePrintFinalDrawnFace(input: PrintFinalFaceInput): PrintFinalDrawnFace {
  const { face, blocks, look, tile, framing, bleed } = input
  const immersive = face.look === 'immersive'
  const photo = usePreviewFinalPhoto(immersive ? look.heroUrl : null)
  const logo = usePreviewFinalLogo(look.logoUrl)
  const read = photo.status === 'read' ? photo.value : null
  const logoRead = logo.status === 'read' ? logo.value : null
  return useMemo((): PrintFinalDrawnFace => {
    if (!immersive) {
      return {
        look: 'paper',
        layout: previewFinalFaceLayout({
          face,
          blocks,
          look,
          tile,
          logoAspect: logoRead?.aspect ?? null,
        }),
        colours: printFinalPaperColours(paperPrintKitPalette(look.accentColour)),
      }
    }
    return {
      look: 'immersive',
      laid: previewFinalImmersiveFace({
        face,
        blocks,
        look,
        tile,
        logo: logoRead,
        photo: read,
        framing,
        bleed,
      }),
      photo: read,
      waiting: photo.status === 'reading',
    }
  }, [immersive, face, blocks, look, tile, logoRead, read, framing, bleed, photo.status])
}
