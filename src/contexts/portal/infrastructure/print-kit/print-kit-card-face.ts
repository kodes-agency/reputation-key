// A Large card, 4 × 6 in or A6, drawn from its plan (`planLargeCard`, round-2
// spec-delta R1 and R2, round-3 S3): the words measured in the fonts the PDF
// embeds, the logo measured to its ink, and on Immersive the photo band run into
// the bleed on the top and both sides with the cream plate straddling its edge.
//
// Laid out in the face's own coordinates, in points, from the top-left corner of
// its trim; the page places it and says how far it bleeds.

import type {
  PrintFace,
  PrintKitPaper,
  PrintKitStyle,
} from '#/shared/domain/portal-print-kit'
import {
  CARD_BAND_MONOGRAM,
  CARD_PLATE,
  type CardBox,
} from '#/shared/domain/portal-print-kit-card-brand'
import { planLargeCard, type LargeCardPlan } from '#/shared/domain/portal-print-kit-card'
import {
  cardColours,
  type CardColours,
} from '#/shared/domain/portal-print-kit-card-colours'
import type { CodeTile } from '#/shared/domain/portal-print-kit-code-tile'
import type {
  ImmersivePrintKitPalette,
  PrintKitPalette,
} from '#/shared/domain/portal-print-kit-palette'
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
import type { QrMatrix } from './print-kit-qr'
import { drawMonogram } from './print-kit-window'

export type CardFaceArt = Readonly<{
  style: PrintKitStyle
  paper: PrintKitPaper
  palette: PrintKitPalette
  qr: QrMatrix
  tile: CodeTile
  wordmark: string
  propertyName: string
  /** The logo, and the plate it sits on (every logo on Immersive); null for the wordmark. */
  logo: FaceLogo | null
}>

export type CardFaceLayout = Readonly<{
  plan: LargeCardPlan
  code: CodeBlockArt
  logo: FaceLogo | null
  palette: PrintKitPalette
  colours: CardColours
}>

/** The drawing's width over its height, measured to its ink. */
const inkAspect = (logo: FaceLogo): number =>
  (logo.image.width * (logo.ink.right - logo.ink.left)) /
  Math.max(1, logo.image.height * (logo.ink.bottom - logo.ink.top))

/** Where everything on a Large card goes. */
export function layoutCardFace(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  face: PrintFace,
  art: CardFaceArt,
): CardFaceLayout {
  const code = planFaceCodeBlock(doc, fonts, face, art.qr, art.palette, art.tile)
  const display = fontMetrics(doc, fonts, 'display')
  const plan = planLargeCard({
    style: art.style,
    paper: art.paper,
    face,
    brand:
      art.logo === null
        ? { kind: 'wordmark', text: art.wordmark }
        : {
            kind: 'logo',
            inkAspect: inkAspect(art.logo),
            plate: art.logo.plate !== null,
          },
    propertyName: art.propertyName,
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

/** The plate's soft shadow, as rings of low opacity spreading out from under it. */
function drawPlateShadow(doc: PDFKit.PDFDocument, plate: CardBox): void {
  const { offsetYPt, blurPt, alpha } = CARD_PLATE.shadow
  const rings = 5
  // Each ring adds the same opacity, so where they all overlap the shadow reaches about `alpha` / 2.
  const each = 1 - (1 - alpha / 2) ** (1 / rings)
  doc.save()
  for (let ring = 0; ring < rings; ring += 1) {
    const spread = (blurPt * ring) / (rings - 1) / 2
    doc
      .roundedRect(
        plate.x - spread,
        plate.y + offsetYPt - spread,
        plate.widthPt + 2 * spread,
        plate.heightPt + 2 * spread,
        CARD_PLATE.radiusPt + spread,
      )
      .fillColor('#000000', each)
      .fill()
  }
  doc.restore()
}

/** The logo's drawing in its ink box: the whole file scaled and placed so its transparent margin falls outside, and clipped. */
function drawLogo(doc: PDFKit.PDFDocument, logo: FaceLogo, ink: CardBox): void {
  const { image } = logo
  const scale = ink.widthPt / (image.width * (logo.ink.right - logo.ink.left))
  doc.save()
  doc.rect(ink.x, ink.y, ink.widthPt, ink.heightPt).clip()
  drawImage(doc, image, {
    x: ink.x - logo.ink.left * image.width * scale,
    y: ink.y - logo.ink.top * image.height * scale,
    width: image.width * scale,
    height: image.height * scale,
  })
  doc.restore()
}

function drawBrand(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  layout: CardFaceLayout,
): void {
  const { brand } = layout.plan
  if (brand.kind === 'wordmark') {
    drawCardWords(doc, fonts, brand.lines, layout.colours, {
      x: 0,
      widthPt: layout.plan.widthPt,
    })
    return
  }
  if (layout.logo === null) return
  const plate = brand.plate
  if (plate !== null && layout.logo.plate !== null) {
    if (layout.plan.style === 'immersive') drawPlateShadow(doc, plate)
    doc.save()
    doc
      .roundedRect(plate.x, plate.y, plate.widthPt, plate.heightPt, CARD_PLATE.radiusPt)
      .fill(layout.logo.plate)
    doc.restore()
  }
  drawLogo(doc, layout.logo, brand.ink)
}

export type CardFaceDrawing = Readonly<{
  /** The photo cropped to this face's band with its bleed; null for the monogram. */
  photo: OpenedImage | null
  letter: string
}>

/** The band across the top: the photo or the monogram, run into the bleed on the top and both sides. */
function drawBand(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  layout: CardFaceLayout & Readonly<{ palette: ImmersivePrintKitPalette }>,
  drawing: CardFaceDrawing,
  bleed: FaceBleed,
): void {
  const { plan, palette } = layout
  if (plan.bandPt === null) return
  const area = {
    x: -bleed.sidePt,
    y: -bleed.topPt,
    width: plan.widthPt + 2 * bleed.sidePt,
    height: plan.bandPt + bleed.topPt,
  }
  doc.save()
  doc.rect(area.x, area.y, area.width, area.height).clip()
  if (drawing.photo !== null) {
    drawImage(doc, drawing.photo, area)
  } else {
    // The ground runs into the bleed; the letter is centred on the band as it is trimmed.
    doc.rect(area.x, area.y, area.width, area.height).fill(palette.plateTone)
    drawMonogram(
      doc,
      fonts,
      { x: 0, y: 0, widthPt: plan.widthPt, heightPt: plan.bandPt },
      { palette, letter: drawing.letter },
      CARD_BAND_MONOGRAM,
    )
  }
  doc.restore()
}

const isImmersive = (
  layout: CardFaceLayout,
): layout is CardFaceLayout & Readonly<{ palette: ImmersivePrintKitPalette }> =>
  layout.palette.style === 'immersive'

/** Draws a laid-out card: on Immersive its field and band first, running `bleed` past the trim. */
export function drawCardFace(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  layout: CardFaceLayout,
  drawing: CardFaceDrawing,
  bleed: FaceBleed,
): void {
  const { plan } = layout
  if (isImmersive(layout)) {
    drawField(doc, layout.palette, plan, bleed, null)
    drawBand(doc, fonts, layout, drawing, bleed)
  }
  drawBrand(doc, fonts, layout)
  drawCardWords(doc, fonts, plan.words, layout.colours, plan.column)
  drawCodeBlock(doc, fonts, layout.code, plan.code.plan, plan.code)
}
