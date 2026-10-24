// The small table tent's face (round-3 spec-delta S5), 5 × 3.5 in or 130 × 90 mm,
// drawn from the plan the PDF draws from (`previewTentPlan`): on Immersive the
// photo panel down the left, full height, then a row of the words, set from the
// column's left edge, and the code block; on Paper the same row on the paper with
// the code's outline. The top edge is the fold. Each part is placed absolutely
// from the plan, in container units of the face's width.
//
// With no photo the panel holds the monogram, as in the file. On a print-shop
// page the sheet paints the field into the bleed (`bare`), and the panel runs into
// it on each edge the face bleeds, never across the fold.
//
// Inline styles on purpose, as the rest of the print preview's.

import { useState } from 'react'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type {
  PrintFace,
  PrintKitPaper,
  PrintKitStyle,
} from '#/shared/domain/portal-print-kit'
import { cardColours } from '#/shared/domain/portal-print-kit-card-colours'
import { cueLinesFor } from '#/shared/domain/portal-print-kit-code-block'
import type { CodeTile } from '#/shared/domain/portal-print-kit-code-tile'
import {
  PRINT_KIT_PAPER,
  immersivePrintKitPalette,
  paperPrintKitPalette,
} from '#/shared/domain/portal-print-kit-palette'
import { NO_BLEED, type PanelBleed } from '#/shared/domain/portal-print-kit-sheet-parts'
import { tentPanelMonogram } from '#/shared/domain/portal-print-kit-tent'
import { Brand, Word } from './print-kit-card-parts-art'
import { PrintKitCodeBlock } from './print-kit-code-block'
import type { PointsToLength } from './print-kit-code-block-layout'
import { immersiveBackground } from './print-kit-immersive-art-layout'
import { PrintKitPhotoArea } from './print-kit-photo-area-art'
import { leadLanguageOf, previewTentPlan } from './print-kit-tent-art-layout'

export function PrintKitTentArt({
  style,
  paper,
  face,
  look,
  codeUrl,
  tile,
  bleed = NO_BLEED,
  bare = false,
  pt,
}: Readonly<{
  style: PrintKitStyle
  paper: PrintKitPaper
  face: PrintFace
  look: PortalPrintKitView['look']
  codeUrl: string | null
  tile: CodeTile
  /** How far the panel runs past each edge: a print-shop page's bleed, but never the fold. */
  bleed?: PanelBleed
  /** Drawn with no ground, the page having painted the field into the bleed behind it. */
  bare?: boolean
  pt: PointsToLength
}>) {
  const [logoAspect, setLogoAspect] = useState<number | null>(null)
  const plan = previewTentPlan({ style, paper, face, look, tile, logoAspect })
  const palette =
    style === 'paper'
      ? paperPrintKitPalette(look.accentColour)
      : immersivePrintKitPalette(look.accentColour, look.fieldColour)
  const colours = cardColours(palette)
  const ground =
    palette.style === 'paper' ? PRINT_KIT_PAPER : immersiveBackground(palette)
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: bare ? 'visible' : 'hidden',
        background: bare ? 'transparent' : ground,
      }}
    >
      {palette.style === 'immersive' && plan.panelPt !== null && (
        <PrintKitPhotoArea
          trimmed={{ x: 0, y: 0, widthPt: plan.panelPt, heightPt: plan.heightPt }}
          bleed={{ ...bleed, rightPt: 0 }}
          look={look}
          palette={palette}
          monogram={tentPanelMonogram({
            panelPt: plan.panelPt,
            heightPt: plan.heightPt,
          })}
          pt={pt}
        />
      )}
      <Brand
        brand={plan.brand}
        column={plan.column}
        align="left"
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
          align="left"
          colours={colours}
          pt={pt}
        />
      ))}
      <div style={{ position: 'absolute', left: pt(plan.code.x), top: pt(plan.code.y) }}>
        <PrintKitCodeBlock
          palette={palette}
          cues={cueLinesFor(leadLanguageOf(face).blocks.map((block) => block.locale))}
          codeUrl={codeUrl}
          pt={pt}
          tile={tile}
        />
      </div>
    </div>
  )
}
