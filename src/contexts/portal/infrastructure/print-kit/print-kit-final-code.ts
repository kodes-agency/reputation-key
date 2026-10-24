// The final code block in the PDF (final design spec §5.2): the cream tile with
// the symbol and its four-module quiet zone, the accent bar joined under it with
// the cue in each language and no icon, their corners rounded at 5 % of the
// tile. On Paper a 0.35 mm outline in the accent ink runs outside the cream
// square and the bar, so the quiet zone keeps its four modules and the inner
// edge keeps the 5 % radius.
//
// Drawn in the face's coordinates, in points, from the block's outer top-left
// corner (the outline's, on Paper), where the planner put it.

import type { PrintFinalCue } from '#/shared/domain/portal-print-final-face'
import type { PrintFinalCodeBlock } from '#/shared/domain/portal-print-final-code'
import {
  PRINT_FINAL_DISTANCES,
  mmPt,
  type PrintFinalBox,
} from '#/shared/domain/portal-print-final-measures'
import { PRINT_FINAL_TYPE_SETTINGS } from '#/shared/domain/portal-print-final-type'
import { PRINT_KIT_TILE } from '#/shared/domain/portal-print-kit-palette'
import {
  drawCentredLine,
  type PdfTextStyle,
  type PrintKitFonts,
} from './print-kit-pdf-text'
import { drawCode } from './print-kit-code-block'
import type { QrMatrix } from './print-kit-qr'

export type FinalCodeColours = Readonly<{
  /** The Paper outline; null on Immersive, which has none. */
  outline: string | null
  barFill: string
  barText: string
}>

export type FinalCodeArt = Readonly<{
  qr: QrMatrix
  cues: readonly PrintFinalCue[]
  cuePt: number
  colours: FinalCodeColours
}>

/** The cue lines, centred in the bar as one block: 1.12 line boxes, 0.3 mm apart. */
function drawCues(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  art: FinalCodeArt,
  bar: Readonly<{ centreX: number; top: number; heightPt: number }>,
) {
  const { leading, lineGapMm } = PRINT_FINAL_TYPE_SETTINGS.cue
  const lineBox = art.cuePt * leading
  const gap = mmPt(lineGapMm)
  const block = art.cues.length * lineBox + (art.cues.length - 1) * gap
  const top = bar.top + (bar.heightPt - block) / 2
  const style: PdfTextStyle = {
    face: 'bodyStrong',
    size: art.cuePt,
    spacing: 0,
    colour: art.colours.barText,
    opacity: 1,
  }
  art.cues.forEach((cue, index) => {
    drawCentredLine(doc, fonts, cue.text, style, {
      centreX: bar.centreX,
      middleY: top + index * (lineBox + gap) + lineBox / 2,
    })
  })
}

/** Draws the block in its planned box: the outline first, then the tile and the bar clipped to their rounded corners. */
export function drawFinalCodeBlock(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  art: FinalCodeArt,
  block: PrintFinalCodeBlock,
  box: PrintFinalBox,
): void {
  const { tilePt, barPt, outlinePt } = block
  const inner = { x: box.leftPt + outlinePt, y: box.topPt + outlinePt }
  const radius = tilePt * PRINT_FINAL_DISTANCES.tileRadiusShare
  doc.save()
  if (art.colours.outline !== null && outlinePt > 0) {
    doc
      .roundedRect(box.leftPt, box.topPt, block.widthPt, block.heightPt, block.radiusPt)
      .fill(art.colours.outline)
  }
  doc.save()
  doc.roundedRect(inner.x, inner.y, tilePt, tilePt + barPt, radius).clip()
  doc.rect(inner.x, inner.y, tilePt, tilePt).fill(PRINT_KIT_TILE)
  drawCode(doc, art.qr, tilePt, inner)
  doc.rect(inner.x, inner.y + tilePt, tilePt, barPt).fill(art.colours.barFill)
  doc.restore()
  drawCues(doc, fonts, art, {
    centreX: inner.x + tilePt / 2,
    top: inner.y + tilePt,
    heightPt: barPt,
  })
  doc.restore()
}
