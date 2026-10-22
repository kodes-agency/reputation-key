// One redesigned face, drawn as the PDF draws it (spec 4.2 and 4.4): a Paper
// counter card (4 × 6 in or A6) or a Paper tent face (8.5 × 5.5 in or A5). The
// same flex layout the design boards use, from the same measures the PDF reads:
//
//   - the card: the brand at the top margin, the code block at the bottom
//     margin, the words centred between, two equal gaps either side of them;
//   - the tent face: the brand top-left, then a row of the words and the code,
//     whose tile's top sits on the place label's cap line, and three equal gaps
//     so the margin at the fold is the margin at the sheet's edge.
//
// Margins are optical, as in the PDF: the paddings are the margin less the
// distance from the brand's box to its ink and plus the tile's outline. The
// preview cannot read a logo's alpha, so it takes the boards' 1.2 mm edge.
//
// Laid out in container units of the face's own width, so it scales with its
// column or its slot on a sheet. Inline styles on purpose, as the rest of the
// print preview's: the first-paint stylesheet is built by scanning `src/` for
// class names, and a measure this specific would land in every page's.

import type { CSSProperties, ReactNode } from 'react'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type { PrintFace } from '#/shared/domain/portal-print-kit'
import { cueLinesFor } from '#/shared/domain/portal-print-kit-code-block'
import { stripUnsupportedCharacters } from '#/shared/domain/portal-print-kit-font-ranges'
import {
  CARD_GRID,
  CODE_BLOCK,
  FIT,
  LOGO_BOX_MM,
  MARGIN,
  TENT_FACE,
  TENT_FACE_GRID,
  TENT_WORDMARK_PT,
  WORDMARK,
  mmToPt,
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
import { LINING_FIGURES } from './print-kit-art-layout'
import { PrintKitCodeBlock } from './print-kit-code-block'
import type { PointsToLength } from './print-kit-code-block-layout'
import { previewPaperScale, ptToContainerWidth } from './print-kit-paper-art-layout'
import { PrintKitPaperStack } from './print-kit-paper-stack'

type Props = Readonly<{
  /** Only Paper is drawn in this release. */
  style: 'paper'
  geometry: PanelGeometry
  face: PrintFace
  look: PortalPrintKitView['look']
  /** The code as a picture with its quiet zone drawn in; null while it is made. */
  codeUrl: string | null
  /** Said by a face shown on its own; a face on a sheet is part of the sheet's picture. */
  label?: string
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

function Brand({
  drawing,
  wordmarkPt,
  logoHeightPt,
  align,
}: Readonly<{
  drawing: Drawing
  wordmarkPt: number
  logoHeightPt: number
  align: 'centre' | 'start'
}>) {
  const { look, palette, pt } = drawing
  if (look.logoUrl !== null) {
    return (
      <img
        src={look.logoUrl}
        alt=""
        style={{
          display: 'block',
          flex: 'none',
          alignSelf: align === 'centre' ? 'center' : 'flex-start',
          height: pt(logoHeightPt),
          width: 'auto',
          maxWidth: pt(mmToPt(LOGO_BOX_MM.width)),
          objectFit: 'contain',
          // The logo's transparent edge, cancelled optically on the tent (spec 4.4).
          marginLeft: align === 'start' ? pt(TENT_FACE.logoShiftPt) : 0,
        }}
      />
    )
  }
  return (
    <p
      style={{
        margin: 0,
        flex: 'none',
        fontFamily: 'var(--font-guest-display)',
        fontWeight: 600,
        ...LINING_FIGURES,
        fontSize: pt(wordmarkPt),
        lineHeight: WORDMARK.lineBoxEm,
        letterSpacing: `${WORDMARK.trackingEm}em`,
        // Centred, the tracking after the last letter is balanced on the left.
        paddingLeft: align === 'centre' ? `${WORDMARK.trackingEm}em` : 0,
        textTransform: 'uppercase',
        // The file sets a tracked line letter by letter: no ligature joins a TT.
        fontVariantLigatures: 'none',
        whiteSpace: 'nowrap',
        color: palette.ink,
      }}
    >
      {stripUnsupportedCharacters(look.wordmark)}
    </p>
  )
}

/** Where a brand's ink starts inside its box: a logo's transparent edge, or the wordmark's cap line. */
const brandInkPt = (look: PortalPrintKitView['look'], wordmarkPt: number) =>
  look.logoUrl !== null
    ? MARGIN.optical.logoEdgePt
    : (MARGIN.optical.wordmarkCapPt * wordmarkPt) / WORDMARK.pt

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

const CodeBlock = ({ drawing }: Readonly<{ drawing: Drawing }>): ReactNode => (
  <PrintKitCodeBlock
    palette={drawing.palette}
    cues={cueLinesFor(drawing.face.blocks.map((block) => block.locale))}
    codeUrl={drawing.codeUrl}
    pt={drawing.pt}
  />
)

function PaperCard({
  drawing,
  geometry,
}: Readonly<{ drawing: Drawing; geometry: 'card4x6' | 'cardA6' }>) {
  const grid = CARD_GRID.paper[geometry === 'card4x6' ? 'letter' : 'a4']
  const { pt, face } = drawing
  const top = grid.marginPt - brandInkPt(drawing.look, WORDMARK.pt)
  const bottom = grid.marginPt + CODE_BLOCK.outlinePt
  return (
    <div
      style={{
        ...surface(pt, `${pt(top)} ${pt(grid.sidePt)} ${pt(bottom)}`),
        alignItems: 'center',
        textAlign: 'center',
      }}
    >
      <Brand
        drawing={drawing}
        wordmarkPt={WORDMARK.pt}
        logoHeightPt={mmToPt(LOGO_BOX_MM.height)}
        align="centre"
      />
      <Gap min={FIT.paperGapPt.brand} pt={pt} />
      <PrintKitPaperStack
        face={face}
        scale={previewPaperScale(face, geometry)}
        align="centre"
        palette={drawing.palette}
        pt={pt}
      />
      <Gap min={FIT.paperGapPt.code} pt={pt} />
      <CodeBlock drawing={drawing} />
    </div>
  )
}

function PaperTentFace({
  drawing,
  geometry,
}: Readonly<{ drawing: Drawing; geometry: 'tentFaceLetter' | 'tentFaceA5' }>) {
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
      <Brand
        drawing={drawing}
        wordmarkPt={TENT_WORDMARK_PT}
        logoHeightPt={TENT_FACE.logoHeightPt}
        align="start"
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
          <PrintKitPaperStack
            face={face}
            scale="tent"
            align="start"
            palette={drawing.palette}
            pt={pt}
          />
        </div>
        <div
          style={{
            flex: 'none',
            width: pt(CODE_BLOCK.tilePt),
            paddingTop: pt(TENT_FACE.codeTopOffsetPt),
          }}
        >
          <CodeBlock drawing={drawing} />
        </div>
      </div>
      <Gap min={grid.foldClearancePt - bottom} pt={pt} />
    </div>
  )
}

/** A Paper face of the shape; Paper has no tent panels, which are Immersive's. */
function paperArt(drawing: Drawing, geometry: PanelGeometry): ReactNode {
  switch (geometry) {
    case 'card4x6':
    case 'cardA6':
      return <PaperCard drawing={drawing} geometry={geometry} />
    case 'tentFaceLetter':
    case 'tentFaceA5':
      return <PaperTentFace drawing={drawing} geometry={geometry} />
    default:
      return null
  }
}

export function PrintKitFaceArt({ geometry, face, look, codeUrl, label }: Props) {
  const widthPt = PANEL_SIZE_PT[geometry].widthPt
  const drawing: Drawing = {
    face,
    look,
    codeUrl,
    palette: paperPrintKitPalette(look.accentColour),
    pt: (points) => ptToContainerWidth(points, widthPt),
  }
  const { heightPt } = PANEL_SIZE_PT[geometry]
  return (
    <div
      {...(label === undefined ? {} : { role: 'img', 'aria-label': label })}
      style={{
        width: '100%',
        aspectRatio: `${widthPt} / ${heightPt}`,
        containerType: 'inline-size',
      }}
    >
      {paperArt(drawing, geometry)}
    </div>
  )
}
