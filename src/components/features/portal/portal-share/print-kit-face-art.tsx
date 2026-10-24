// One face, drawn as the PDF draws it: the Large card (4 × 6 in or A6) in
// either style through `PrintKitCardArt`, from the plan the PDF draws from
// (round-2 spec-delta R1 and R2, round-3 S3); a Paper tent face (8.5 × 5.5 in or
// A5, spec 4.4); and an Immersive tent panel through `PrintKitImmersiveFace`.
// The tent face is the flex layout its design board uses, from the measures the
// PDF reads: the brand top-left, then a row of the words and the code, whose
// tile's top sits on the place label's cap line, and three equal gaps so the
// margin at the fold is the margin at the sheet's edge.
//
// Margins are optical, as in the PDF: the paddings are the margin less the
// distance from the brand's box to its ink and plus the tile's outline. The
// preview cannot read a logo's alpha, so it takes the boards' 1.2 mm edge. The
// type scale, the brand's size and the long-copy steps come from
// `previewPaperFit`, by the PDF's rules, so a long title never pushes the code
// block off the face.
//
// Laid out in container units of the face's own width, so it scales with its
// column or its slot on a sheet. Inline styles on purpose, as the rest of the
// print preview's: the first-paint stylesheet is built by scanning `src/` for
// class names, and a measure this specific would land in every page's.

import type { CSSProperties, ReactNode } from 'react'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type { PrintFace, PrintKitStyle } from '#/shared/domain/portal-print-kit'
import { cueLinesFor } from '#/shared/domain/portal-print-kit-code-block'
import { CODE_TILE, type CodeTile } from '#/shared/domain/portal-print-kit-code-tile'
import {
  CODE_BLOCK,
  TENT_FACE,
  TENT_FACE_GRID,
  TENT_WORDMARK_PT,
} from '#/shared/domain/portal-print-kit-measures'
import {
  PRINT_KIT_PAPER,
  paperPrintKitPalette,
  type PaperPrintKitPalette,
} from '#/shared/domain/portal-print-kit-palette'
import {
  PANEL_SIZE_PT,
  type PanelGeometry,
} from '#/shared/domain/portal-print-kit-sheets'
import { PrintKitCardArt } from './print-kit-card-art'
import { PrintKitCodeBlock } from './print-kit-code-block'
import type { PointsToLength } from './print-kit-code-block-layout'
import { ptToContainerWidth } from './print-kit-paper-art-layout'
import {
  previewPaperFit,
  tentCodeOffsetPt,
  type PreviewPaperFit,
} from './print-kit-preview-fit'
import { PrintKitFaceBrand, brandInkPt } from './print-kit-face-brand-art'
import { PrintKitFaceStack } from './print-kit-face-stack'
import { PrintKitImmersiveFace } from './print-kit-immersive-face-art'

type Props = Readonly<{
  style: PrintKitStyle
  geometry: PanelGeometry
  face: PrintFace
  look: PortalPrintKitView['look']
  /** The code as a picture with its quiet zone drawn in; null while it is made. */
  codeUrl: string | null
  /** Said by a face shown on its own; a face on a sheet is part of the sheet's picture. */
  label?: string
  /**
   * Drawn with no ground: on a print-shop sheet the field and the ridge band run
   * into the bleed behind the face, so the sheet paints them (Immersive only).
   */
  bare?: boolean
  /** A card's code tile, the one its address allows; the 1.75 in tile of the sample code when none is given. */
  tile?: CodeTile
  /** How far a print-shop sheet's bleed runs past a card's trim, for its band to run into; 0 alone. */
  bleedPt?: number
}>

type Drawing = Readonly<{
  face: PrintFace
  look: PortalPrintKitView['look']
  codeUrl: string | null
  palette: PaperPrintKitPalette
  pt: PointsToLength
}>

/** A flexible gap: it takes an equal share of the spare height, and never less than `min`. */
const Gap = ({ min, pt }: Readonly<{ min: number; pt: PointsToLength }>) => (
  <div aria-hidden style={{ flex: '1 1 0', minHeight: pt(min) }} />
)

/**
 * The face's paper, filling its container. Its own lengths are in the
 * container's units: an element's container units read its nearest container
 * ancestor, never itself, so the container is the wrapper round it.
 */
const surface = (pt: PointsToLength, padding: string): CSSProperties => {
  return {
    position: 'relative',
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
    padding,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: PRINT_KIT_PAPER,
    fontFamily: 'var(--font-guest-body)',
    fontSize: pt(10),
  }
}

const paperColours = (palette: PaperPrintKitPalette) => ({
  ink: palette.ink,
  soft: palette.soft,
  accentInk: palette.accentInk,
  rule: palette.accentInk,
})

const CodeBlock = ({ drawing }: Readonly<{ drawing: Drawing }>): ReactNode => (
  <PrintKitCodeBlock
    palette={drawing.palette}
    cues={cueLinesFor(drawing.face.blocks.map((block) => block.locale))}
    codeUrl={drawing.codeUrl}
    pt={drawing.pt}
  />
)

function PaperTentFace({
  drawing,
  geometry,
  fit,
}: Readonly<{
  drawing: Drawing
  geometry: 'tentFaceLetter' | 'tentFaceA5'
  fit: PreviewPaperFit
}>) {
  const grid = TENT_FACE_GRID[geometry === 'tentFaceLetter' ? 'letter' : 'a4']
  const { pt, face } = drawing
  const bottom = brandInkPt(drawing.look, TENT_WORDMARK_PT) + CODE_BLOCK.outlinePt
  return (
    <div
      style={{
        ...surface(pt, `0 ${pt(grid.sidePt)} ${pt(bottom)}`),
        textAlign: 'left',
      }}
    >
      <Gap min={grid.foldClearancePt} pt={pt} />
      <PrintKitFaceBrand
        look={drawing.look}
        colour={drawing.palette.ink}
        wordmarkPt={TENT_WORDMARK_PT}
        logoHeightPt={TENT_FACE.logoHeightPt}
        align="start"
        pt={pt}
      />
      <Gap min={TENT_FACE.logoToRowMinPt} pt={pt} />
      <div
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'flex-start',
          gap: pt(TENT_FACE.rowGapPt),
        }}
      >
        <div
          style={{
            flex: '1 1 0',
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
          }}
        >
          <PrintKitFaceStack
            face={face}
            scale={fit.scale}
            sizes={fit.sizes}
            align="start"
            colours={paperColours(drawing.palette)}
            pt={pt}
          />
        </div>
        <div
          style={{
            flex: 'none',
            width: pt(CODE_BLOCK.tilePt),
            paddingTop: pt(tentCodeOffsetPt(fit.sizes.place)),
          }}
        >
          <CodeBlock drawing={drawing} />
        </div>
      </div>
      <Gap min={grid.foldClearancePt - bottom} pt={pt} />
    </div>
  )
}

/** A Paper tent face; the cards are `PrintKitCardArt`'s, and Paper has no tent panels, which are Immersive's. */
function paperArt(drawing: Drawing, geometry: PanelGeometry): ReactNode {
  const fit = previewPaperFit(drawing.face, geometry, drawing.look)
  if (fit === null) return null
  switch (geometry) {
    case 'tentFaceLetter':
    case 'tentFaceA5':
      return <PaperTentFace drawing={drawing} geometry={geometry} fit={fit} />
    default:
      return null
  }
}

/** The paper each card shape is printed on. */
const CARD_PAPER = { card4x6: 'letter', cardA6: 'a4' } as const

const isCard = (geometry: PanelGeometry): geometry is keyof typeof CARD_PAPER =>
  geometry in CARD_PAPER

export function PrintKitFaceArt({
  style,
  geometry,
  face,
  look,
  codeUrl,
  label,
  bare = false,
  tile,
  bleedPt = 0,
}: Props) {
  const { widthPt, heightPt } = PANEL_SIZE_PT[geometry]
  const pt: PointsToLength = (points) => ptToContainerWidth(points, widthPt)
  const drawing: Drawing = {
    face,
    look,
    codeUrl,
    palette: paperPrintKitPalette(look.accentColour),
    pt,
  }
  return (
    <div
      {...(label === undefined ? {} : { role: 'img', 'aria-label': label })}
      style={{
        width: '100%',
        aspectRatio: `${widthPt} / ${heightPt}`,
        containerType: 'inline-size',
      }}
    >
      {isCard(geometry) ? (
        <PrintKitCardArt
          style={style}
          paper={CARD_PAPER[geometry]}
          face={face}
          look={look}
          codeUrl={codeUrl}
          tile={tile ?? CODE_TILE.large[CARD_PAPER[geometry]]}
          bleedPt={bleedPt}
          pt={pt}
        />
      ) : style === 'paper' ? (
        paperArt(drawing, geometry)
      ) : (
        <PrintKitImmersiveFace
          geometry={geometry}
          face={face}
          look={look}
          codeUrl={codeUrl}
          bare={bare}
          pt={pt}
        />
      )}
    </div>
  )
}
