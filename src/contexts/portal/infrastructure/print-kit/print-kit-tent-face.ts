// A small table tent's face drawn from its plan (`planTent`, round-3 spec-delta
// S5): the words measured in the fonts the PDF embeds, the logo measured to its
// ink, and on Immersive the field under the whole face with the photo panel down
// its left edge, run into the bleed on each edge that bleeds (never the fold).
// One language a face: the lead language's words and its one cue line.
//
// Laid out in the face's own coordinates, in points, from the top-left corner of
// its trim; the page places it, turns the back face over the fold, and says how
// far it bleeds.

import type { PrintFace } from '#/shared/domain/portal-print-kit'
import { CARD_BAND_MONOGRAM } from '#/shared/domain/portal-print-kit-card-brand'
import {
  cardColours,
  type CardColours,
} from '#/shared/domain/portal-print-kit-card-colours'
import type { ImmersivePrintKitPalette } from '#/shared/domain/portal-print-kit-palette'
import { planTent, type TentPlan } from '#/shared/domain/portal-print-kit-tent'
import { drawBrand, inkAspect, type CardFaceArt } from './print-kit-card-face'
import { pdfStyleOf } from './print-kit-card-style'
import { drawCardWords } from './print-kit-card-words'
import {
  drawCodeBlock,
  planFaceCodeBlock,
  type CodeBlockArt,
} from './print-kit-code-block'
import type { FaceLogo } from './print-kit-face-brand'
import { drawField } from './print-kit-immersive-field'
import type { FaceBleed } from './print-kit-pages'
import { drawImage, type OpenedImage } from './print-kit-pdf-image'
import {
  capTopInLineBox,
  fontMetrics,
  measureLine,
  type PrintKitFonts,
} from './print-kit-pdf-text'
import { drawMonogram } from './print-kit-window'

export type TentFaceLayout = Readonly<{
  plan: TentPlan
  code: CodeBlockArt
  logo: FaceLogo | null
  palette: CardFaceArt['palette']
  colours: CardColours
}>

/** The face with its lead language alone: the tent prints one language a face. */
const leadLanguageOf = (face: PrintFace): PrintFace => ({
  ...face,
  blocks: face.blocks.slice(0, 1),
})

/** Where everything on a small tent's face goes. */
export function layoutTentFace(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  face: PrintFace,
  art: CardFaceArt,
): TentFaceLayout {
  const lead = leadLanguageOf(face)
  const code = planFaceCodeBlock(doc, fonts, lead, art.qr, art.palette, art.tile)
  const display = fontMetrics(doc, fonts, 'display')
  const plan = planTent({
    style: art.style,
    paper: art.paper,
    face: lead,
    brand:
      art.logo === null
        ? { kind: 'wordmark', text: art.wordmark }
        : {
            kind: 'logo',
            inkAspect: inkAspect(art.logo),
            plate: art.logo.plate !== null,
          },
    code: code.plan,
    measure: (text, style) => measureLine(doc, fonts, text, pdfStyleOf(style, '#000000')),
    wordmarkInkTopPt: (size) => capTopInLineBox(display, size, 0.75),
  })
  return {
    plan,
    code: code.art,
    logo: art.logo,
    palette: art.palette,
    colours: cardColours(art.palette),
  }
}

export type TentFaceDrawing = Readonly<{
  /** The photo cropped to this face's panel with its bleed; null for the monogram. */
  photo: OpenedImage | null
  letter: string
}>

/**
 * The panel with no photo: the brand's first letter on the lighter ground, set
 * to 62 % of the panel's width (the band's share of its height, turned to fit a
 * panel narrower than it is tall), with no rules: the band's two 12 mm rules
 * are wider than the panel. Not drawn on the boards.
 */
function panelMonogram(plan: TentPlan, panelPt: number) {
  return {
    ...CARD_BAND_MONOGRAM,
    letterShare: (CARD_BAND_MONOGRAM.letterShare * panelPt) / plan.heightPt,
    ruleLengthPt: 0,
    gapPt: 0,
  }
}

/** The photo panel down the left: the photo or the monogram, run into the bleed on the left, top and foot. */
function drawPanel(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  layout: TentFaceLayout & Readonly<{ palette: ImmersivePrintKitPalette }>,
  drawing: TentFaceDrawing,
  bleed: FaceBleed,
): void {
  const { plan, palette } = layout
  if (plan.panelPt === null) return
  const area = {
    x: -bleed.leftPt,
    y: -bleed.topPt,
    width: plan.panelPt + bleed.leftPt,
    height: plan.heightPt + bleed.topPt + bleed.bottomPt,
  }
  doc.save()
  doc.rect(area.x, area.y, area.width, area.height).clip()
  if (drawing.photo !== null) {
    drawImage(doc, drawing.photo, area)
  } else {
    doc.rect(area.x, area.y, area.width, area.height).fill(palette.plateTone)
    drawMonogram(
      doc,
      fonts,
      { x: 0, y: 0, widthPt: plan.panelPt, heightPt: plan.heightPt },
      { palette, letter: drawing.letter },
      panelMonogram(plan, plan.panelPt),
    )
  }
  doc.restore()
}

const isImmersive = (
  layout: TentFaceLayout,
): layout is TentFaceLayout & Readonly<{ palette: ImmersivePrintKitPalette }> =>
  layout.palette.style === 'immersive'

/** Draws a laid-out tent face: on Immersive its field and panel first, running `bleed` past the trim. */
export function drawTentFace(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  layout: TentFaceLayout,
  drawing: TentFaceDrawing,
  bleed: FaceBleed,
): void {
  const { plan } = layout
  if (isImmersive(layout)) {
    drawField(doc, layout.palette, plan, bleed, null)
    drawPanel(doc, fonts, layout, drawing, bleed)
  }
  const { brand, column } = plan
  drawBrand(
    doc,
    fonts,
    brand,
    { logo: layout.logo, style: plan.style, colours: layout.colours },
    { x: column.x, widthPt: column.widthPt, align: 'left' },
  )
  drawCardWords(doc, fonts, plan.words, layout.colours, column, 'left')
  drawCodeBlock(doc, fonts, layout.code, plan.code.plan, plan.code)
}
