// A Paper face (spec 4.2 and 4.4): ink on the customer's own paper, with no
// background, no photo and no bleed. Two shapes, two papers each:
//
//   - the counter card (4 × 6 in, or A6): the brand fixed at the top margin, the
//     code block at the bottom margin, the words centred between them, and the
//     spare height shared equally by the two gaps either side of the words;
//   - the tent face (8.5 × 5.5 in, or A5 landscape): the brand top-left, and
//     under it a row of the words, left-aligned, and the code, whose tile's top
//     sits on the place label's cap line. The spare height is shared by three
//     equal gaps, above the brand, between brand and row and under the row, so
//     the face has the same margin at the fold as at the sheet's edge.
//
// Margins are optical: the top one is measured to the brand's ink (its cap line,
// or a logo's drawing), the bottom one to the tile's outline, which is drawn
// outside the 2 in. Laid out in the face's own coordinates, in points, from the
// top-left corner of its trim; the page places and turns it.

import type { PrintFace } from '#/shared/domain/portal-print-kit'
import {
  cueLinesFor,
  codeBlockColours,
  type CodeBlockPlan,
} from '#/shared/domain/portal-print-kit-code-block'
import {
  CARD_GRID,
  CODE_BLOCK,
  FIT,
  STACK,
  TENT_FACE,
  TENT_FACE_GRID,
  TENT_WORDMARK_PT,
  WORDMARK,
  LOGO_BOX_MM,
  mmToPt,
} from '#/shared/domain/portal-print-kit-measures'
import type { PaperPrintKitPalette } from '#/shared/domain/portal-print-kit-palette'
import type { PanelGeometry } from '#/shared/domain/portal-print-kit-sheets'
import {
  drawCodeBlock,
  planPdfCodeBlock,
  type CodeBlockArt,
} from './print-kit-code-block'
import {
  drawBrand,
  planBrand,
  type BrandPlan,
  type BrandSize,
  type FaceBrandArt,
} from './print-kit-face-brand'
import {
  drawFaceStack,
  layoutFaceStack,
  stackScales,
  type FaceStack,
  type PlacedStack,
} from './print-kit-face-stack'
import { shareGaps } from './print-kit-gaps'
import {
  capTopInLineBox,
  fontMetrics,
  measureLine,
  type PrintKitFonts,
} from './print-kit-pdf-text'
import type { QrMatrix } from './print-kit-qr'

export type PaperFaceArt = Readonly<{
  palette: PaperPrintKitPalette
  brand: FaceBrandArt
  qr: QrMatrix
}>

export type PaperFaceLayout = Readonly<{
  brand: Readonly<{ plan: BrandPlan; x: number; y: number; align: 'centre' | 'start' }>
  stack: PlacedStack
  code: Readonly<{ plan: CodeBlockPlan; art: CodeBlockArt; x: number; y: number }>
}>

type Sizing = Readonly<{
  doc: PDFKit.PDFDocument
  fonts: PrintKitFonts
  face: PrintFace
  art: PaperFaceArt
}>

const colours = (palette: PaperPrintKitPalette) => ({
  ink: palette.ink,
  soft: palette.soft,
  accentInk: palette.accentInk,
  rule: palette.accentInk,
})

function codeOf(sizing: Sizing): Readonly<{ plan: CodeBlockPlan; art: CodeBlockArt }> {
  const cues = cueLinesFor(sizing.face.blocks.map((block) => block.locale))
  return {
    plan: planPdfCodeBlock(sizing.doc, sizing.fonts, cues),
    art: { qr: sizing.art.qr, cues, colours: codeBlockColours(sizing.art.palette) },
  }
}

function stackAt(
  sizing: Sizing,
  scale: Parameters<typeof layoutFaceStack>[0]['scale'],
  maxWidthPt: number,
): FaceStack {
  const { doc, fonts } = sizing
  return layoutFaceStack({
    blocks: sizing.face.blocks,
    scale,
    maxWidthPt,
    colours: colours(sizing.art.palette),
    measure: (text, style) => measureLine(doc, fonts, text, style),
  })
}

/**
 * The card's candidates, roomiest first (spec 2.5): the full type scale, then
 * for two languages the stepped-down one (fit step c), then the brand at its
 * floor. The first that leaves the two gaps their minimums is the one printed.
 */
function cardCandidates(sizing: Sizing, maxWidthPt: number) {
  const scales = stackScales(sizing.face.blocks.length, false)
  const full: BrandSize = {
    wordmarkPt: WORDMARK.pt,
    logoHeightPt: mmToPt(LOGO_BOX_MM.height),
    maxWidthPt,
  }
  const floor: BrandSize = {
    ...full,
    wordmarkPt: FIT.wordmarkFloorPt,
    logoHeightPt: FIT.logoFloorPt,
  }
  const last = scales[scales.length - 1] ?? 'one'
  return [
    ...scales.map((scale) => ({ scale, brand: full })),
    { scale: last, brand: floor },
  ]
}

function layoutPaperCard(
  sizing: Sizing,
  geometry: 'card4x6' | 'cardA6',
): PaperFaceLayout {
  const grid = CARD_GRID.paper[geometry === 'card4x6' ? 'letter' : 'a4']
  const maxWidthPt = grid.widthPt - 2 * grid.sidePt
  const code = codeOf(sizing)
  // The outline is drawn outside the block: its bottom edge is at the margin.
  const codeTop =
    grid.heightPt - grid.marginPt - CODE_BLOCK.outlinePt - code.plan.heightPt
  const minimums = [FIT.paperGapPt.brand, FIT.paperGapPt.code]
  const needed = FIT.paperGapPt.brand + FIT.paperGapPt.code
  const tries = cardCandidates(sizing, maxWidthPt).map((candidate) => {
    const brand = planBrand(sizing.doc, sizing.fonts, sizing.art.brand, candidate.brand)
    const stack = stackAt(sizing, candidate.scale, maxWidthPt)
    const brandTop = grid.marginPt - brand.inkTopPt
    const free = codeTop - (brandTop + brand.heightPt) - stack.heightPt
    return { brand, stack, brandTop, free }
  })
  const chosen = tries.find((attempt) => attempt.free >= needed) ?? tries.at(-1)
  if (chosen === undefined)
    throw new Error('A card has at least one way to set its words')
  const [aboveStack = 0] = shareGaps(chosen.free, minimums)
  return {
    brand: {
      plan: chosen.brand,
      x: (grid.widthPt - chosen.brand.widthPt) / 2,
      y: chosen.brandTop,
      align: 'centre',
    },
    stack: {
      stack: chosen.stack,
      x: grid.sidePt,
      y: chosen.brandTop + chosen.brand.heightPt + aboveStack,
      widthPt: maxWidthPt,
      align: 'centre',
    },
    code: { ...code, x: (grid.widthPt - CODE_BLOCK.tilePt) / 2, y: codeTop },
  }
}

function layoutPaperTent(
  sizing: Sizing,
  geometry: 'tentFaceLetter' | 'tentFaceA5',
): PaperFaceLayout {
  const grid = TENT_FACE_GRID[geometry === 'tentFaceLetter' ? 'letter' : 'a4']
  const codeX = grid.widthPt - grid.sidePt - CODE_BLOCK.tilePt
  const wordsWidth = codeX - TENT_FACE.rowGapPt - grid.sidePt
  const code = codeOf(sizing)
  const brand = planBrand(sizing.doc, sizing.fonts, sizing.art.brand, {
    wordmarkPt: TENT_WORDMARK_PT,
    logoHeightPt: TENT_FACE.logoHeightPt,
    maxWidthPt: wordsWidth,
  })
  const stack = stackAt(sizing, 'tent', wordsWidth)
  // The tile's top on the place label's cap line, from the font, not from a constant.
  const codeOffset =
    stack.first === null
      ? TENT_FACE.codeTopOffsetPt
      : capTopInLineBox(
          fontMetrics(sizing.doc, sizing.fonts, 'display'),
          stack.first.style.size,
          STACK.leading.place,
        )
  const rowHeight = Math.max(stack.heightPt, codeOffset + code.plan.heightPt)
  // The brand's ink starts this far inside its box, and the outline sits this far
  // outside the code's: padding by both puts the two inks at equal distances.
  const bottomPad = brand.inkTopPt + CODE_BLOCK.outlinePt
  const free = grid.heightPt - bottomPad - brand.heightPt - rowHeight
  const [aboveBrand = 0, aboveRow = 0] = shareGaps(free, [
    grid.foldClearancePt,
    TENT_FACE.logoToRowMinPt,
    grid.foldClearancePt - bottomPad,
  ])
  const rowTop = aboveBrand + brand.heightPt + aboveRow
  return {
    brand: {
      plan: brand,
      x: grid.sidePt - brand.inkLeftPt,
      y: aboveBrand,
      align: 'start',
    },
    stack: { stack, x: grid.sidePt, y: rowTop, widthPt: wordsWidth, align: 'start' },
    code: { ...code, x: codeX, y: rowTop + codeOffset },
  }
}

/** Where everything on a Paper face goes. */
export function layoutPaperFace(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  face: PrintFace,
  art: PaperFaceArt,
  geometry: PanelGeometry,
): PaperFaceLayout {
  const sizing = { doc, fonts, face, art }
  switch (geometry) {
    case 'card4x6':
    case 'cardA6':
      return layoutPaperCard(sizing, geometry)
    case 'tentFaceLetter':
    case 'tentFaceA5':
      return layoutPaperTent(sizing, geometry)
    default:
      throw new Error(`A Paper face is a card or a tent face, not a ${geometry}`)
  }
}

/** Draws a laid-out Paper face. Nothing is painted under it: the paper is the customer's. */
export function drawPaperFace(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  layout: PaperFaceLayout,
): void {
  drawBrand(doc, fonts, layout.brand.plan, layout.brand)
  drawFaceStack(doc, fonts, layout.stack)
  drawCodeBlock(doc, fonts, layout.code.art, layout.code.plan, layout.code)
}
