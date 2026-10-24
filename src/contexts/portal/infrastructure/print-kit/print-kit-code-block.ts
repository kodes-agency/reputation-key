// The code block, drawn as the design board draws it (spec 2.3): a cream tile
// with the code on it, and under it, joined with no gap and exactly as wide, a
// bar in the accent that holds a camera pictogram and the cue, in the lead
// language first. The whole object has rounded corners; on Paper an outline is
// drawn outside it, so the bar still measures the tile, the size check. The tile
// is the plan's: today's 2 in, or the one a size chose (`chooseCodeTile`).
//
// Drawn in the caller's coordinates, in points, from the tile's top-left corner.
// `planPdfCodeBlock` measures the cue in the PDF's own fonts and says how tall the
// object is, so a face can place it before it draws it.

import {
  PRINT_KIT_QR_QUIET_ZONE_MODULES,
  type PrintFace,
} from '#/shared/domain/portal-print-kit'
import {
  CAMERA_ICON,
  codeBlockColours,
  cueLinesFor,
  cueBlockHeightPt,
  cueLineHeightPt,
  cueTrackingPt,
  planCodeBlock,
  type CodeBlockColours,
  type CodeBlockPlan,
  type CueLine,
} from '#/shared/domain/portal-print-kit-code-block'
import {
  TODAY_CODE_TILE,
  type CodeTile,
} from '#/shared/domain/portal-print-kit-code-tile'
import { CODE_BLOCK } from '#/shared/domain/portal-print-kit-measures'
import {
  PRINT_KIT_INK,
  PRINT_KIT_TILE,
  type PrintKitPalette,
} from '#/shared/domain/portal-print-kit-palette'
import {
  drawLine,
  measureLine,
  type PdfTextStyle,
  type PrintKitFonts,
} from './print-kit-pdf-text'
import { qrDarkRuns, type QrMatrix } from './print-kit-qr'

export type CodeBlockArt = Readonly<{
  qr: QrMatrix
  cues: readonly CueLine[]
  colours: CodeBlockColours
}>

const cueStyle = (sizePt: number, colour: string): PdfTextStyle => ({
  face: 'bodyStrong',
  size: sizePt,
  spacing: cueTrackingPt(sizePt),
  colour,
  opacity: 1,
})

/** Measures the cue in the PDF's fonts and plans the block: where the pictogram goes, how tall it is. */
export function planPdfCodeBlock(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  cues: readonly CueLine[],
  tile: CodeTile = TODAY_CODE_TILE,
): CodeBlockPlan {
  return planCodeBlock(
    cues,
    (cue, size) => measureLine(doc, fonts, cue.text, cueStyle(size, PRINT_KIT_INK)),
    tile,
  )
}

/** A face's code block, planned in the PDF's fonts: its cue lines in the face's languages, its colours from the style. */
export function planFaceCodeBlock(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  face: PrintFace,
  qr: QrMatrix,
  palette: PrintKitPalette,
  tile: CodeTile = TODAY_CODE_TILE,
): Readonly<{ plan: CodeBlockPlan; art: CodeBlockArt }> {
  const cues = cueLinesFor(face.blocks.map((block) => block.locale))
  return {
    plan: planPdfCodeBlock(doc, fonts, cues, tile),
    art: { qr, cues, colours: codeBlockColours(palette) },
  }
}

type Corner = Readonly<{ x: number; y: number }>

/** The tile's code: one rectangle per run of dark modules, inside its quiet zone. */
function drawCode(
  doc: PDFKit.PDFDocument,
  qr: QrMatrix,
  tilePt: number,
  at: Corner,
): void {
  const module = tilePt / (qr.size + 2 * PRINT_KIT_QR_QUIET_ZONE_MODULES)
  const quiet = PRINT_KIT_QR_QUIET_ZONE_MODULES
  for (const run of qrDarkRuns(qr)) {
    doc.rect(
      at.x + (quiet + run.column) * module,
      at.y + (quiet + run.row) * module,
      run.length * module,
      module,
    )
  }
  doc.fill(PRINT_KIT_INK)
}

/** The camera, in strokes on its 24-unit grid, scaled so the grid is `sizePt`. */
function drawCamera(
  doc: PDFKit.PDFDocument,
  at: Corner,
  sizePt: number,
  colour: string,
): void {
  const { body, lens, strokeWidth, grid } = CAMERA_ICON
  doc.save()
  doc.translate(at.x, at.y).scale(sizePt / grid)
  doc.lineWidth(strokeWidth).lineCap('round').lineJoin('round')
  doc.path(body).stroke(colour)
  doc.circle(lens.cx, lens.cy, lens.r).stroke(colour)
  doc.restore()
}

/**
 * The pictogram and the cue lines in the bar. Beside the lines, the two are
 * centred as one group; above them, the pictogram and the lines are centred
 * in the bar with the same space above, between and below.
 */
function drawBar(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  art: CodeBlockArt,
  plan: CodeBlockPlan,
  at: Corner,
): void {
  const style = cueStyle(plan.cuePt, art.colours.barText)
  const widths = art.cues.map((cue) => measureLine(doc, fonts, cue.text, style))
  const textWidth = Math.max(0, ...widths)
  const lineHeight = cueLineHeightPt(plan)
  const blockHeight = cueBlockHeightPt(plan, art.cues.length)
  const { tilePt, iconGapPt } = plan.tile
  const barTop = at.y + tilePt
  const centreX = at.x + tilePt / 2

  // Beside or under the pictogram the lines are left-aligned (spec 2.4); with
  // no pictogram each is centred in the column the widest sets (round-3 S2).
  const centred = plan.iconPt === 0
  const drawCues = (left: number, top: number) =>
    art.cues.forEach((cue, index) => {
      const indent = centred ? (textWidth - (widths[index] ?? textWidth)) / 2 : 0
      drawLine(doc, fonts, cue.text, style, {
        x: left + indent,
        middleY: top + index * (lineHeight + CODE_BLOCK.cueGapPt) + lineHeight / 2,
      })
    })

  if (plan.iconAbove) {
    const space = (plan.barPt - plan.iconPt - blockHeight) / 3
    drawCamera(
      doc,
      { x: centreX - plan.iconPt / 2, y: barTop + space },
      plan.iconPt,
      art.colours.barText,
    )
    drawCues(centreX - textWidth / 2, barTop + 2 * space + plan.iconPt)
    return
  }
  // A tile with no pictogram centres its cue alone.
  const iconSlot = plan.iconPt === 0 ? 0 : plan.iconPt + iconGapPt
  const left = centreX - (iconSlot + textWidth) / 2
  const middle = barTop + plan.barPt / 2
  if (plan.iconPt > 0) {
    drawCamera(
      doc,
      { x: left, y: middle - plan.iconPt / 2 },
      plan.iconPt,
      art.colours.barText,
    )
  }
  drawCues(left + iconSlot, middle - blockHeight / 2)
}

/**
 * Draws the code block with its tile's top-left corner at `at`, as planned by
 * `planPdfCodeBlock`. The outline, when there is one, is a ring outside the
 * object: it is filled first and the object is drawn over it, so no seam shows.
 */
export function drawCodeBlock(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  art: CodeBlockArt,
  plan: CodeBlockPlan,
  at: Corner,
): void {
  const { tilePt, radiusPt } = plan.tile
  const { outlinePt } = CODE_BLOCK
  doc.save()
  if (art.colours.outline !== null) {
    doc
      .roundedRect(
        at.x - outlinePt,
        at.y - outlinePt,
        tilePt + 2 * outlinePt,
        plan.heightPt + 2 * outlinePt,
        radiusPt + outlinePt,
      )
      .fill(art.colours.outline)
  }
  doc.save()
  doc.roundedRect(at.x, at.y, tilePt, plan.heightPt, radiusPt).clip()
  doc.rect(at.x, at.y, tilePt, tilePt).fill(PRINT_KIT_TILE)
  drawCode(doc, art.qr, tilePt, at)
  doc.rect(at.x, at.y + tilePt, tilePt, plan.barPt).fill(art.colours.barFill)
  doc.restore()
  drawBar(doc, fonts, art, plan, at)
  doc.restore()
}
