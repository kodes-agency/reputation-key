// A card of any size, 4 × 6 in or A6, 3.5 × 5 in or 90 × 130 mm, 2 × 3.5 in or
// 55 × 85 mm, in either style, drawn from the plan the PDF draws from
// (`previewCardPlan`): on Immersive the photo band across the top with the cream
// plate straddling its edge, then the name, the message and the code block, every
// part where the file puts it. Each part is placed absolutely from the plan, in
// container units of the card's width, so it scales with its column or its slot
// on a sheet.
//
// With no photo the band holds the monogram. On a print-shop or office sheet the
// sheet paints the field into the bleed (`bare`), and the band runs into it on
// each edge the card bleeds, as in the file.
//
// Inline styles on purpose, as the rest of the print preview's: the first-paint
// stylesheet is built by scanning `src/` for class names, and a measure this
// specific would land in every page's.

import { useState } from 'react'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type {
  PrintFace,
  PrintKitPaper,
  PrintKitSize,
  PrintKitStyle,
} from '#/shared/domain/portal-print-kit'
import { CARD_BAND_MONOGRAM } from '#/shared/domain/portal-print-kit-card-brand'
import { cueLinesFor } from '#/shared/domain/portal-print-kit-code-block'
import type { CodeTile } from '#/shared/domain/portal-print-kit-code-tile'
import { NO_BLEED, type PanelBleed } from '#/shared/domain/portal-print-kit-sheet-parts'
import { previewCardPlan } from './print-kit-card-art-layout'
import { Brand, FaceCanvas, Word, faceLook } from './print-kit-card-parts-art'
import { PrintKitCodeBlock } from './print-kit-code-block'
import type { PointsToLength } from './print-kit-code-block-layout'
import { PrintKitPhotoArea } from './print-kit-photo-area-art'

type Props = Readonly<{
  style: PrintKitStyle
  size: PrintKitSize
  paper: PrintKitPaper
  face: PrintFace
  look: PortalPrintKitView['look']
  codeUrl: string | null
  tile: CodeTile
  /** How far the band runs past each edge: a print-shop or office sheet's bleed; none on a card shown alone. */
  bleed?: PanelBleed
  /** Drawn with no ground, the sheet having painted the field into the bleed behind it. */
  bare?: boolean
  /** The property's name under a logo, which the manager may turn off; on when left out. */
  showPropertyName?: boolean
  pt: PointsToLength
}>

export function PrintKitCardArt({
  style,
  size,
  paper,
  face,
  look,
  codeUrl,
  tile,
  bleed = NO_BLEED,
  bare = false,
  showPropertyName = true,
  pt,
}: Props) {
  const [logoAspect, setLogoAspect] = useState<number | null>(null)
  const plan = previewCardPlan({
    size,
    style,
    paper,
    face,
    look,
    tile,
    logoAspect,
    showPropertyName,
  })
  const { palette, colours, ground } = faceLook(style, look)
  return (
    <FaceCanvas ground={ground} bare={bare}>
      {palette.style === 'immersive' && plan.bandPt !== null && (
        <PrintKitPhotoArea
          trimmed={{ x: 0, y: 0, widthPt: plan.widthPt, heightPt: plan.bandPt }}
          bleed={{ ...bleed, bottomPt: 0 }}
          look={look}
          palette={palette}
          monogram={CARD_BAND_MONOGRAM}
          pt={pt}
        />
      )}
      <Brand
        brand={plan.brand}
        column={{ x: 0, widthPt: plan.widthPt }}
        look={look}
        colours={colours}
        onLogoAspect={setLogoAspect}
        pt={pt}
      />
      {plan.words.map((item) => (
        <Word
          key={`${item.kind}:${item.topPt}`}
          item={item}
          column={plan.column}
          colours={colours}
          pt={pt}
        />
      ))}
      <div style={{ position: 'absolute', left: pt(plan.code.x), top: pt(plan.code.y) }}>
        <PrintKitCodeBlock
          palette={palette}
          cues={cueLinesFor(face.blocks.map((block) => block.locale))}
          codeUrl={codeUrl}
          pt={pt}
          tile={tile}
        />
      </div>
    </FaceCanvas>
  )
}
