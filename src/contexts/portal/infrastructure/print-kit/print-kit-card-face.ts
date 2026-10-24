// A card of any size drawn from its plan (`planCard`, round-2 spec-delta R1 and
// R2, round-3 S3): the words measured in the fonts the PDF embeds, the logo
// measured to its ink, and on Immersive the photo band run into the bleed on
// the top and on each side that bleeds, with the cream plate straddling its edge.
//
// Laid out in the face's own coordinates, in points, from the top-left corner of
// its trim; the page places it and says how far it bleeds.

import type {
  PrintFace,
  PrintKitPaper,
  PrintKitSize,
  PrintKitStyle,
} from '#/shared/domain/portal-print-kit'
import {
  CARD_BAND_MONOGRAM,
  CARD_PLATE,
  type CardBox,
  type CardBrand,
} from '#/shared/domain/portal-print-kit-card-brand'
import { planCard, type CardPlan } from '#/shared/domain/portal-print-kit-card'
import {
  cardColours,
  type CardColours,
} from '#/shared/domain/portal-print-kit-card-colours'
import type { CodeTile } from '#/shared/domain/portal-print-kit-code-tile'
import type {
  ImmersivePrintKitPalette,
  PrintKitPalette,
} from '#/shared/domain/portal-print-kit-palette'
import { drawCardWords, type WordsAlign } from './print-kit-card-words'
import {
  drawCodeBlock,
  planFaceCodeBlock,
  type CodeBlockArt,
} from './print-kit-code-block'
import type { FaceLogo } from './print-kit-face-brand'
import { drawField } from './print-kit-immersive-field'
import type { FaceBleed } from './print-kit-pages'
import { drawImage, type OpenedImage } from './print-kit-pdf-image'
import { drawPhotoArea, faceBrandInput, faceMeasures } from './print-kit-face-parts'
import type { PrintKitFonts } from './print-kit-pdf-text'
import type { QrMatrix } from './print-kit-qr'

export type CardFaceArt = Readonly<{
  size: PrintKitSize
  style: PrintKitStyle
  paper: PrintKitPaper
  palette: PrintKitPalette
  qr: QrMatrix
  tile: CodeTile
  wordmark: string
  /** The property's name under a logo; null for none. */
  propertyName: string | null
  /** The logo, and the plate it sits on (every logo on Immersive); null for the wordmark. */
  logo: FaceLogo | null
}>

export type CardFaceLayout = Readonly<{
  plan: CardPlan
  code: CodeBlockArt
  logo: FaceLogo | null
  palette: PrintKitPalette
  colours: CardColours
}>

/** Where everything on a card of its size goes. */
export function layoutCardFace(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  face: PrintFace,
  art: CardFaceArt,
): CardFaceLayout {
  const code = planFaceCodeBlock(doc, fonts, face, art.qr, art.palette, art.tile)
  const plan = planCard({
    size: art.size,
    style: art.style,
    paper: art.paper,
    face,
    brand: faceBrandInput(art),
    propertyName: art.propertyName,
    code: code.plan,
    ...faceMeasures(doc, fonts),
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

/** What a placed brand is drawn with: the logo and its plate, the style, and the wordmark's colour. */
export type BrandArt = Readonly<{
  logo: FaceLogo | null
  style: PrintKitStyle
  colours: CardColours
}>

/**
 * Draws a placed brand: the logo on its plate (with the plate's shadow on
 * Immersive), or the wordmark's lines in `column`, centred (a card) or from its
 * left edge (the small tent).
 */
export function drawBrand(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  brand: CardBrand,
  art: BrandArt,
  column: Readonly<{ x: number; widthPt: number; align: WordsAlign }>,
): void {
  if (brand.kind === 'wordmark') {
    drawCardWords(doc, fonts, brand.lines, art.colours, column, column.align)
    return
  }
  if (art.logo === null) return
  const plate = brand.plate
  if (plate !== null && art.logo.plate !== null) {
    if (art.style === 'immersive') drawPlateShadow(doc, plate)
    doc.save()
    doc
      .roundedRect(plate.x, plate.y, plate.widthPt, plate.heightPt, CARD_PLATE.radiusPt)
      .fill(art.logo.plate)
    doc.restore()
  }
  drawLogo(doc, art.logo, brand.ink)
}

export type CardFaceDrawing = Readonly<{
  /** The photo cropped to this face's band with its bleed; null for the monogram. */
  photo: OpenedImage | null
  letter: string
}>

/** The band across the top: the photo or the monogram, run into the bleed on the top and each side that bleeds. */
function drawBand(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  layout: CardFaceLayout & Readonly<{ palette: ImmersivePrintKitPalette }>,
  drawing: CardFaceDrawing,
  bleed: FaceBleed,
): void {
  const { plan, palette } = layout
  if (plan.bandPt === null) return
  drawPhotoArea(
    doc,
    fonts,
    {
      x: -bleed.leftPt,
      y: -bleed.topPt,
      width: plan.widthPt + bleed.leftPt + bleed.rightPt,
      height: plan.bandPt + bleed.topPt,
    },
    { x: 0, y: 0, widthPt: plan.widthPt, heightPt: plan.bandPt },
    { palette, ...drawing, monogram: CARD_BAND_MONOGRAM },
  )
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
  drawBrand(
    doc,
    fonts,
    plan.brand,
    { logo: layout.logo, style: plan.style, colours: layout.colours },
    { x: 0, widthPt: plan.widthPt, align: 'centre' },
  )
  drawCardWords(doc, fonts, plan.words, layout.colours, plan.column)
  drawCodeBlock(doc, fonts, layout.code, plan.code.plan, plan.code)
}
