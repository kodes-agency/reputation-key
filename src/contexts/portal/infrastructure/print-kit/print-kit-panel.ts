// One printed panel: the field, the photo band when there is a photo, the
// brand, the words, the code on its plate, and the address as text.
//
// Drawn in the panel's own coordinates (points, origin at the top-left of its
// trim), clipped to the trim plus the bleed it is given. The caller places and,
// for the back of a folded tent, turns the coordinate system.

import { PRINT_KIT_QR_QUIET_ZONE_MODULES } from '#/shared/domain/portal-print-kit'
import type { PrintFace } from '#/shared/domain/portal-print-kit'
import {
  ADDRESS_OPACITY,
  BOTTOM_MARGIN_MM,
  BRAND_MIDDLE_MM,
  LOGO_BOX_MM,
  PANEL_HEIGHT_MM,
  PANEL_WIDTH_MM,
  PHOTO_BAND_MM,
  PHOTO_FADE_FROM,
  PLATE_ABOVE_ADDRESS_MM,
  PLATE_MM,
  PLATE_PAPER_MM,
  PLATE_PAPER_RADIUS_MM,
  PLATE_RADIUS_MM,
  SINGLE_LANGUAGE_SCALE,
  STACK_GAP_BELOW_MM,
  STACK_TOP_MM,
  TEXT_WIDTH_PT,
  TYPE_PT,
  mm,
} from './print-kit-geometry'
import { drawWordmark } from './print-kit-brand'
import { drawImage, type OpenedImage } from './print-kit-pdf-image'
import type { PrintKitPalette } from '#/shared/domain/portal-print-kit-palette'
import { drawCentredLine, measureLine, type PrintKitFonts } from './print-kit-pdf-text'
import { qrDarkRuns, qrPlateModules, type QrMatrix } from './print-kit-qr'
import { fitStack, layoutStack, measureWith } from './print-kit-stack'
import { breakAddress, fitFontSize } from '#/shared/domain/portal-print-kit-text'

export type PanelBleed = Readonly<{ topMm: number; sideMm: number; bottomMm: number }>

export type PanelArt = Readonly<{
  palette: PrintKitPalette
  wordmark: string
  logo: OpenedImage | null
  /** A JPEG already cropped to `photoBox`; null when the property has no photo. */
  photo: OpenedImage | null
  qr: QrMatrix
  shortAddress: string
}>

const CENTRE_X = mm(PANEL_WIDTH_MM / 2)

/** What the photo band covers, in millimetres, for a panel with this bleed. */
export function photoBox(bleed: PanelBleed) {
  return {
    widthMm: PANEL_WIDTH_MM + 2 * bleed.sideMm,
    heightMm: PHOTO_BAND_MM + bleed.topMm,
  }
}

/** The panel's trim plus its bleed, as `rect` arguments, in points. */
function bleedRect(bleed: PanelBleed): [number, number, number, number] {
  return [
    -mm(bleed.sideMm),
    -mm(bleed.topMm),
    mm(PANEL_WIDTH_MM + 2 * bleed.sideMm),
    mm(PANEL_HEIGHT_MM + bleed.topMm + bleed.bottomMm),
  ]
}

function drawField(doc: PDFKit.PDFDocument, art: PanelArt, bleed: PanelBleed): void {
  doc.rect(...bleedRect(bleed)).fill(art.palette.field)
}

/** The two washes of colour over the field, as the guest backdrop paints them. */
function drawWashes(doc: PDFKit.PDFDocument, art: PanelArt, bleed: PanelBleed): void {
  const wash = (
    cx: number,
    cy: number,
    radius: number,
    colour: string,
    alpha: number,
  ) => {
    const gradient = doc
      .radialGradient(mm(cx), mm(cy), 0, mm(cx), mm(cy), mm(radius))
      .stop(0, colour, alpha)
      .stop(1, colour, 0)
    doc.rect(...bleedRect(bleed)).fill(gradient)
  }
  wash(13, 128, 80, art.palette.warm, 0.5)
  wash(100, 84, 60, art.palette.cool, 0.5)
}

function drawPhoto(doc: PDFKit.PDFDocument, art: PanelArt, bleed: PanelBleed): void {
  if (art.photo === null) return
  const left = -mm(bleed.sideMm)
  const top = -mm(bleed.topMm)
  const width = mm(PANEL_WIDTH_MM + 2 * bleed.sideMm)
  const bandBottom = mm(PHOTO_BAND_MM)
  drawImage(doc, art.photo, { x: left, y: top, width, height: bandBottom - top })
  // Darken it a little so white type holds, fade it into the field at the foot,
  // and give the brand a scrim at the head.
  doc.save()
  doc.fillOpacity(0.18)
  doc.rect(left, top, width, bandBottom - top).fill('#000000')
  doc.restore()
  const fade = doc
    .linearGradient(0, bandBottom * PHOTO_FADE_FROM, 0, bandBottom)
    .stop(0, art.palette.field, 0)
    .stop(1, art.palette.field, 1)
  doc.rect(left, top, width, bandBottom - top).fill(fade)
  const scrim = doc
    .linearGradient(0, top, 0, mm(29))
    .stop(0, '#000000', 0.6)
    .stop(1, '#000000', 0)
  doc.rect(left, top, width, mm(29) - top).fill(scrim)
}

function drawBrand(doc: PDFKit.PDFDocument, fonts: PrintKitFonts, art: PanelArt): void {
  if (art.logo !== null) {
    const scale = Math.min(
      mm(LOGO_BOX_MM.width) / art.logo.width,
      mm(LOGO_BOX_MM.height) / art.logo.height,
    )
    const width = art.logo.width * scale
    const height = art.logo.height * scale
    drawImage(doc, art.logo, {
      x: CENTRE_X - width / 2,
      y: mm(BRAND_MIDDLE_MM) - height / 2,
      width,
      height,
    })
    return
  }
  drawWordmark(doc, fonts, art.wordmark)
}

type AddressBlock = Readonly<{
  lines: readonly string[]
  size: number
  heightMm: number
}>

/** The address on one line when it fits at a legible size, else on two. */
function layoutAddress(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  address: string,
): AddressBlock {
  const styleAt = (size: number) => ({
    face: 'body' as const,
    size,
    spacing: 0,
    colour: '#FFFFFF',
    opacity: ADDRESS_OPACITY,
  })
  const widest = (lines: readonly string[]) => (size: number) =>
    Math.max(...lines.map((line) => measureLine(doc, fonts, line, styleAt(size))))
  const fitted = (lines: readonly string[]): AddressBlock => {
    const size = fitFontSize({
      size: TYPE_PT.address,
      minSize: TYPE_PT.addressMin,
      maxWidth: TEXT_WIDTH_PT,
      widthAt: widest(lines),
    })
    return { lines, size, heightMm: (lines.length * size * 1.3) / mm(1) }
  }
  const single = fitted([address])
  if (widest([address])(single.size) <= TEXT_WIDTH_PT) return single
  const broken = breakAddress(address)
  return broken ? fitted(broken) : single
}

function drawPlate(doc: PDFKit.PDFDocument, art: PanelArt, plateTopMm: number): void {
  const left = mm((PANEL_WIDTH_MM - PLATE_MM) / 2)
  const top = mm(plateTopMm)
  doc.roundedRect(left, top, mm(PLATE_MM), mm(PLATE_MM), mm(PLATE_RADIUS_MM))
  doc.lineWidth(mm(0.25)).fillOpacity(0.1).strokeOpacity(0.2)
  doc.fillAndStroke('#FFFFFF', '#FFFFFF')
  doc.fillOpacity(1).strokeOpacity(1)
  const inset = mm((PLATE_MM - PLATE_PAPER_MM) / 2)
  const paperLeft = left + inset
  const paperTop = top + inset
  doc
    .roundedRect(
      paperLeft,
      paperTop,
      mm(PLATE_PAPER_MM),
      mm(PLATE_PAPER_MM),
      mm(PLATE_PAPER_RADIUS_MM),
    )
    .fill(art.palette.platePaper)
  // The symbol sits inside a quiet zone of its own width on every side.
  const module = mm(PLATE_PAPER_MM) / qrPlateModules(art.qr.size)
  const quiet = PRINT_KIT_QR_QUIET_ZONE_MODULES
  for (const run of qrDarkRuns(art.qr)) {
    doc.rect(
      paperLeft + (quiet + run.column) * module,
      paperTop + (quiet + run.row) * module,
      run.length * module,
      module,
    )
  }
  doc.fill(art.palette.plateInk)
}

export function drawPanel(
  doc: PDFKit.PDFDocument,
  fonts: PrintKitFonts,
  face: PrintFace,
  art: PanelArt,
  bleed: PanelBleed,
): void {
  doc.save()
  doc.rect(...bleedRect(bleed)).clip()
  drawField(doc, art, bleed)
  drawPhoto(doc, art, bleed)
  drawWashes(doc, art, bleed)
  drawBrand(doc, fonts, art)

  const address = layoutAddress(doc, fonts, art.shortAddress)
  const addressTopMm = PANEL_HEIGHT_MM - BOTTOM_MARGIN_MM - address.heightMm
  const plateTopMm = addressTopMm - PLATE_ABOVE_ADDRESS_MM - PLATE_MM
  const roomMm = plateTopMm - STACK_GAP_BELOW_MM - STACK_TOP_MM
  const measure = measureWith(doc, fonts)
  const stack = fitStack(
    (scale) => layoutStack(face.blocks, art.palette, scale, TEXT_WIDTH_PT, measure),
    roomMm,
    face.blocks.length === 1 ? SINGLE_LANGUAGE_SCALE : 1,
  )
  const startMm = STACK_TOP_MM + Math.max(0, roomMm - stack.heightMm) / 2
  for (const item of stack.items) {
    if (item.kind === 'rule') {
      const y = mm(startMm + item.yMm)
      doc
        .moveTo(CENTRE_X - mm(item.widthMm) / 2, y)
        .lineTo(CENTRE_X + mm(item.widthMm) / 2, y)
        .lineWidth(mm(0.25))
        .strokeColor(item.colour, 0.55)
        .stroke()
      continue
    }
    drawCentredLine(doc, fonts, item.text, item.style, {
      centreX: CENTRE_X,
      middleY: mm(startMm + item.middleMm),
    })
  }
  drawPlate(doc, art, plateTopMm)
  const lineMm = address.heightMm / address.lines.length
  address.lines.forEach((line, index) => {
    drawCentredLine(
      doc,
      fonts,
      line,
      {
        face: 'body',
        size: address.size,
        spacing: 0,
        colour: '#FFFFFF',
        opacity: ADDRESS_OPACITY,
      },
      { centreX: CENTRE_X, middleY: mm(addressTopMm + lineMm * (index + 0.5)) },
    )
  })
  doc.restore()
}
