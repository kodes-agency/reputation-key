// The ground of an Immersive face (spec 3.2 and 5.3): the guest page's dark
// field, run into the bleed so a cutter that strays shows no white edge; the
// guest backdrop's two washes over it, warm in the bottom-left corner and cool on
// the right edge, at 0.30 at their peak; and on a tent panel the low-ink ridge
// band over the fold, with its accent hairline on the band's outer edge.
//
// Drawn in the face's own coordinates, in points, from the top-left corner of its
// trim. The washes are the board's CSS radial gradients: an ellipse sized from
// the face, its colour fading out at 72% of its radii.

import { PRINT_KIT_WASH_ALPHA } from '#/shared/domain/portal-print-kit-palette'
import type { ImmersivePrintKitPalette } from '#/shared/domain/portal-print-kit-palette'
import { mmToPt } from '#/shared/domain/portal-print-kit-measures'
import type { FaceBleed } from './print-kit-pages'

type Size = Readonly<{ widthPt: number; heightPt: number }>

/** A wash: its centre and radii as shares of the face, as the board's `radial-gradient(rx ry at x y)`. */
type Wash = Readonly<{ x: number; y: number; rx: number; ry: number }>

const WARM: Wash = { x: 0, y: 1, rx: 0.72, ry: 0.46 }
const COOL: Wash = { x: 1, y: 0.56, rx: 0.64, ry: 0.42 }
/** Where along its radii a wash has faded out. */
const WASH_FADE = 0.72

/** The ridge band's hairline, on its outer edge. */
const RIDGE_HAIRLINE_PT = mmToPt(0.3)

type Rect = readonly [number, number, number, number]

const bleedRect = (size: Size, bleed: FaceBleed): Rect => [
  -bleed.sidePt,
  -bleed.topPt,
  size.widthPt + 2 * bleed.sidePt,
  size.heightPt + bleed.topPt + bleed.bottomPt,
]

/**
 * One wash, as an elliptical gradient: the page is squashed so the ellipse is a
 * circle, and the bleed rectangle is filled in the squashed space.
 */
function drawWash(
  doc: PDFKit.PDFDocument,
  size: Size,
  area: Rect,
  wash: Wash,
  colour: string,
): void {
  const cx = wash.x * size.widthPt
  const cy = wash.y * size.heightPt
  const rx = wash.rx * size.widthPt
  const squash = (wash.ry * size.heightPt) / rx
  const [left, top, width, height] = area
  doc.save()
  doc.translate(cx, cy).scale(1, squash)
  const gradient = doc
    .radialGradient(0, 0, 0, 0, 0, rx * WASH_FADE)
    .stop(0, colour, PRINT_KIT_WASH_ALPHA)
    .stop(1, colour, 0)
  doc.rect(left - cx, (top - cy) / squash, width, height / squash).fill(gradient)
  doc.restore()
}

/** The field, the washes and, on a tent panel, the ridge band `ridgePt` tall. */
export function drawField(
  doc: PDFKit.PDFDocument,
  palette: ImmersivePrintKitPalette,
  size: Size,
  bleed: FaceBleed,
  ridgePt: number | null,
): void {
  const area = bleedRect(size, bleed)
  doc.save()
  doc.rect(...area).fill(palette.field)
  drawWash(doc, size, area, WARM, palette.warm)
  drawWash(doc, size, area, COOL, palette.cool)
  if (ridgePt !== null) {
    const [left, top, width] = area
    // The washes stay outside the band: it is opaque, and drawn over them.
    doc.rect(left, top, width, ridgePt - top).fill(palette.lift)
    doc
      .rect(left, ridgePt - RIDGE_HAIRLINE_PT, width, RIDGE_HAIRLINE_PT)
      .fill(palette.accentLine)
  }
  doc.restore()
}
