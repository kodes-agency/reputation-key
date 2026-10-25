// The art under an Immersive final face in the PDF (final design spec §6),
// drawn from the shared plan (`printFinalArt`) in its order: the ground and its
// washes, the photo with its fade as a soft mask, the scrims, the no-photo arch,
// the grain blended as overlay, and a tent's fold strip over everything. The
// ground, the washes and the arch are vectors; the photo, the masks and the
// grain are rasters.
//
// Drawn in the face's coordinates, in points, from its trim's top-left corner;
// a page with no bleed clips what runs past the trim.

import type { PrintFinalArt } from '#/shared/domain/portal-print-final-art'
import type { PrintFinalWash } from '#/shared/domain/portal-print-final-layers'
import type { PrintFinalBox } from '#/shared/domain/portal-print-final-measures'
import { PRINT_FINAL_SCRIM_INK } from '#/shared/domain/portal-print-final-photo-sample'
import {
  drawRaster,
  greyImage,
  maskedColour,
  rampMask,
  withOverlay,
  type PdfRasterImage,
} from './print-kit-final-raster'

/** The grain tile: this many pixels square, at this many pixels to the inch (about a quarter millimetre each). */
const GRAIN_TILE_PX = 128
const GRAIN_PX_PER_IN = 100
const GRAIN_TILE_PT = (GRAIN_TILE_PX / GRAIN_PX_PER_IN) * 72
const GRAIN_SEED = 0x5eed_9a1e

/** A small seeded generator, so a print's grain is the same every time it is made. */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/** Grey noise round mid-grey, which overlay leaves unchanged on average: the boards' fractal grain, desaturated. */
export function grainTile(doc: PDFKit.PDFDocument): PdfRasterImage {
  const next = seeded(GRAIN_SEED)
  const bytes = Buffer.alloc(GRAIN_TILE_PX * GRAIN_TILE_PX)
  for (let at = 0; at < bytes.length; at++) {
    bytes[at] = Math.round(((next() + next()) / 2) * 255)
  }
  return greyImage(doc, { bytes, width: GRAIN_TILE_PX, height: GRAIN_TILE_PX })
}

const rect = (doc: PDFKit.PDFDocument, box: PrintFinalBox) =>
  doc.rect(box.leftPt, box.topPt, box.rightPt - box.leftPt, box.bottomPt - box.topPt)

/** One wash as an elliptical gradient: the page squashed so the ellipse is a circle, the ground box filled in that space. */
function drawWash(doc: PDFKit.PDFDocument, wash: PrintFinalWash, area: PrintFinalBox) {
  const squash = wash.ryPt / wash.rxPt
  doc.save()
  doc.translate(wash.xPt, wash.yPt).scale(1, squash)
  const gradient = doc
    .radialGradient(0, 0, 0, 0, 0, wash.rxPt * wash.fade)
    .stop(0, wash.colour, wash.alpha)
    .stop(1, wash.colour, 0)
  doc
    .rect(
      area.leftPt - wash.xPt,
      (area.topPt - wash.yPt) / squash,
      area.rightPt - area.leftPt,
      (area.bottomPt - area.topPt) / squash,
    )
    .fill(gradient)
  doc.restore()
}

/**
 * The arch round the brand and the words on an upright face with no photo: the
 * boards' path on a 100 × 140 grid stretched to its box, two straight sides and
 * a half ellipse over them.
 */
function drawArch(doc: PDFKit.PDFDocument, arch: NonNullable<PrintFinalArt['arch']>) {
  const { box } = arch
  const width = box.rightPt - box.leftPt
  const height = box.bottomPt - box.topPt
  const x = (unit: number) => box.leftPt + (unit / 100) * width
  const y = (unit: number) => box.topPt + (unit / 140) * height
  const rx = (48 / 100) * width
  const ry = (48 / 140) * height
  const k = 0.552_284_75
  doc.save()
  doc
    .moveTo(x(2), y(140))
    .lineTo(x(2), y(50))
    .bezierCurveTo(x(2), y(50) - k * ry, x(50) - k * rx, y(2), x(50), y(2))
    .bezierCurveTo(x(50) + k * rx, y(2), x(98), y(50) - k * ry, x(98), y(50))
    .lineTo(x(98), y(140))
  doc.lineWidth(arch.strokePt).strokeOpacity(arch.opacity).stroke(arch.colour)
  doc.restore()
}

export type FinalArtImages = Readonly<{
  /** The photo cropped to the art's cover box, its fade already its soft mask; null with no photo. */
  photo: PdfRasterImage | null
  grain: PdfRasterImage
  /** One per scrim of the art, in order: the scrim ink under its ramps. */
  scrims: readonly PdfRasterImage[]
}>

/** The scrims' images, made once however many times the art is drawn. */
export function scrimImages(
  doc: PDFKit.PDFDocument,
  art: PrintFinalArt,
): readonly PdfRasterImage[] {
  return art.scrims.map((scrim) =>
    maskedColour(doc, PRINT_FINAL_SCRIM_INK, rampMask(doc, scrim.ramps, scrim.box)),
  )
}

function drawGrain(doc: PDFKit.PDFDocument, art: PrintFinalArt, grain: PdfRasterImage) {
  const area = art.groundBox
  doc.save()
  rect(doc, area).clip()
  withOverlay(doc, art.grainOpacity, () => {
    for (let top = area.topPt; top < area.bottomPt; top += GRAIN_TILE_PT) {
      for (let left = area.leftPt; left < area.rightPt; left += GRAIN_TILE_PT) {
        drawRaster(doc, grain, {
          leftPt: left,
          topPt: top,
          rightPt: left + GRAIN_TILE_PT,
          bottomPt: top + GRAIN_TILE_PT,
        })
      }
    }
  })
  doc.restore()
}

/** Draws the art under a face. */
export function drawFinalArt(
  doc: PDFKit.PDFDocument,
  art: PrintFinalArt,
  images: FinalArtImages,
): void {
  doc.save()
  rect(doc, art.groundBox).fill(art.ground)
  for (const wash of art.washes) drawWash(doc, wash, art.groundBox)
  if (art.photo !== null && images.photo !== null) {
    doc.save()
    rect(doc, art.photo.box).clip()
    drawRaster(doc, images.photo, art.photo.cover)
    doc.restore()
  }
  art.scrims.forEach((scrim, index) => {
    const image = images.scrims[index]
    if (image !== undefined) drawRaster(doc, image, scrim.box)
  })
  if (art.arch !== null) drawArch(doc, art.arch)
  drawGrain(doc, art, images.grain)
  if (art.foldStrip !== null) rect(doc, art.foldStrip.box).fill(art.foldStrip.colour)
  doc.restore()
}
