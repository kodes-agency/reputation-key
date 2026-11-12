// A face as the Share tab's preview draws it, laid out once: Paper by the
// planner the PDF uses (`previewFaceLayout`), Immersive by its painter too
// (`previewImmersiveFace`), from the browser's decode of the photo and the
// logo. Laying an Immersive face out reads every word against the photo, so the
// preview does it once and draws the result wherever it is needed: the face on
// its own and every cell of the sheet (`bleed` gives the sheet's own copy, its art
// run into the bleed).

import { useMemo } from 'react'
import type { PortalPrintKitView } from '#/contexts/portal/application/portal-management-contracts'
import type { PrintTextBlock } from '#/shared/domain/portal-print-kit'
import type { PrintFace } from '#/shared/domain/portal-print'
import type { PrintTile } from '#/shared/domain/portal-print-code'
import { printPaperColours } from '#/shared/domain/portal-print-colours'
import type { PrintFaceLayout } from '#/shared/domain/portal-print-face'
import type { PrintFraming } from '#/shared/domain/portal-print-framing'
import type { PrintImmersiveFace } from '#/shared/domain/portal-print-immersive-face'
import type { PrintBleed } from '#/shared/domain/portal-print-layers'
import { paperPrintKitPalette } from '#/shared/domain/portal-print-kit-palette'
import { previewFaceLayout, previewImmersiveFace } from './print-face-layout'
import { usePreviewLogo, usePreviewPhoto, type PreviewPhoto } from './use-print-pictures'

export type PrintDrawnFaceInput = Readonly<{
  face: PrintFace
  blocks: readonly PrintTextBlock[]
  look: PortalPrintKitView['look']
  tile: PrintTile
  /** How the manager framed the photo for this piece and orientation (Immersive). */
  framing?: PrintFraming
  /** How far the art runs past the trim, on a sheet; none on its own. */
  bleed?: PrintBleed
}>

export type PrintDrawnFace =
  | Readonly<{
      look: 'paper'
      layout: PrintFaceLayout
      colours: ReturnType<typeof printPaperColours>
    }>
  | Readonly<{
      look: 'immersive'
      laid: PrintImmersiveFace
      /** The decoded photo, null with none; `waiting` while it decodes. */
      photo: PreviewPhoto | null
      waiting: boolean
    }>

export function usePrintDrawnFace(input: PrintDrawnFaceInput): PrintDrawnFace {
  const { face, blocks, look, tile, framing, bleed } = input
  const immersive = face.look === 'immersive'
  const photo = usePreviewPhoto(immersive ? look.heroUrl : null)
  const logo = usePreviewLogo(look.logoUrl)
  const read = photo.status === 'read' ? photo.value : null
  const logoRead = logo.status === 'read' ? logo.value : null
  return useMemo((): PrintDrawnFace => {
    if (!immersive) {
      return {
        look: 'paper',
        layout: previewFaceLayout({
          face,
          blocks,
          look,
          tile,
          logoAspect: logoRead?.aspect ?? null,
        }),
        colours: printPaperColours(paperPrintKitPalette(look.accentColour)),
      }
    }
    return {
      look: 'immersive',
      laid: previewImmersiveFace({
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
