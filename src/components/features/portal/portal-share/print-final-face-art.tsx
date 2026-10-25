// A final face in the Share tab's preview (final design spec §2 to §8), drawn
// from the layout the PDF draws from. Paper is plain paper with the words,
// marks and code on it (`PrintFinalFaceParts`); Immersive paints its photo fade
// under them (`PrintFinalImmersiveFaceArt`).
//
// Inline styles on purpose, as the rest of the print preview's: the first-paint
// stylesheet is built by scanning `src/` for class names, and a measure this
// specific would land in every page's.

import { useState } from 'react'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type { PrintTextBlock } from '#/shared/domain/portal-print-kit'
import type { PrintFinalFace } from '#/shared/domain/portal-print-final'
import type { PrintFinalTile } from '#/shared/domain/portal-print-final-code'
import { printFinalPaperColours } from '#/shared/domain/portal-print-final-colours'
import type { PrintFinalFraming } from '#/shared/domain/portal-print-final-framing'
import {
  PRINT_KIT_PAPER,
  paperPrintKitPalette,
} from '#/shared/domain/portal-print-kit-palette'
import type { PointsToLength } from './print-kit-code-block-layout'
import { previewFinalFaceLayout } from './print-final-face-layout'
import { PrintFinalFaceParts } from './print-final-face-parts'
import { PrintFinalImmersiveFaceArt } from './print-final-immersive-face-art'

type Props = Readonly<{
  face: PrintFinalFace
  blocks: readonly PrintTextBlock[]
  look: PortalPrintKitView['look']
  tile: PrintFinalTile
  /** The code as a picture with its quiet zone drawn in; null while it is made. */
  codeUrl: string | null
  /** How the manager framed the photo for this piece and orientation (Immersive). */
  framing?: PrintFinalFraming
  pt: PointsToLength
}>

function PrintFinalPaperFaceArt({ face, blocks, look, tile, codeUrl, pt }: Props) {
  const [logoAspect, setLogoAspect] = useState<number | null>(null)
  const layout = previewFinalFaceLayout({ face, blocks, look, tile, logoAspect })
  return (
    <div
      data-final-look="paper"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: PRINT_KIT_PAPER,
      }}
    >
      <PrintFinalFaceParts
        layout={layout}
        colours={printFinalPaperColours(paperPrintKitPalette(look.accentColour))}
        look={look}
        codeUrl={codeUrl}
        onLogoAspect={setLogoAspect}
        pt={pt}
      />
    </div>
  )
}

export function PrintFinalFaceArt(props: Props) {
  return props.face.look === 'immersive' ? (
    <PrintFinalImmersiveFaceArt {...props} />
  ) : (
    <PrintFinalPaperFaceArt {...props} />
  )
}
