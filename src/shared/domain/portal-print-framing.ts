// How an Immersive print frames its photo (design spec §6.2 and
// §6.4): cropped to cover its box with bleed at the property's focal point,
// then moved and zoomed by the manager, one framing per piece and orientation.
// Change photo (slice 7) is where a manager sets a framing; this is the data
// and the arithmetic, shared so the PDF crops the pixels the preview shows.
//
// A zoom of z draws the photo as if its box were z times larger, cropped to
// cover that larger box at the focal point, and shows the box-sized window
// `anchor` of the way along what the zoom added (0 the left or top, 1 the right
// or foot). A zoom of 1 is the plain cover crop, wherever the anchor is. The
// zoom divides the photo's dpi, so the soft-photo notice follows it.

import type { PrintFace } from './portal-print'
import type { PrintPhotoPixels } from './portal-print-photo'

export type PrintFraming = Readonly<{
  zoom: number
  anchorX: number
  anchorY: number
}>

/** Zoom 1.0 to 1.5 (§6.4). */
const PRINT_ZOOM = Object.freeze({ min: 1, max: 1.5 })

/** The framing a photo has until the manager moves it: the plain cover crop. */
export const PRINT_DEFAULT_FRAMING: PrintFraming = Object.freeze({
  zoom: 1,
  anchorX: 0.5,
  anchorY: 0.5,
})

/** The framings stored for one photo: one per piece and orientation, the rest default. */
export type PrintFramings = Readonly<
  Partial<Record<`${PrintFace['piece']}-${PrintFace['orientation']}`, PrintFraming>>
>

const clamp = (value: number, low: number, high: number) =>
  Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : low

/** A framing held to its ranges: zoom 1 to 1.5, anchors 0 to 1. */
export function printFraming(framing: Partial<PrintFraming> = {}): PrintFraming {
  return {
    zoom: clamp(framing.zoom ?? 1, PRINT_ZOOM.min, PRINT_ZOOM.max),
    anchorX: clamp(framing.anchorX ?? 0.5, 0, 1),
    anchorY: clamp(framing.anchorY ?? 0.5, 0, 1),
  }
}

/** The framing a face uses: its own when one is stored, else the plain cover crop. */
export const printFramingOf = (
  framings: PrintFramings | undefined,
  face: Pick<PrintFace, 'piece' | 'orientation'>,
): PrintFraming => printFraming(framings?.[`${face.piece}-${face.orientation}`] ?? {})

export type PrintFocal = Readonly<{ x: number; y: number }>

/** The part of the photo a box shows, in the photo's own pixels. */
export type PrintPhotoCrop = Readonly<{
  leftPx: number
  topPx: number
  widthPx: number
  heightPx: number
}>

/**
 * The part of a photo of `photo` pixels that covers a box `cover` points wide
 * and tall (the box with its bleed), at `focal`, under `framing`. The focal
 * point places the crop as the guest page's `object-position` does: the crop
 * sits `focal` of the way along what overflows.
 */
export function printPhotoCrop(
  photo: PrintPhotoPixels,
  cover: Readonly<{ widthPt: number; heightPt: number }>,
  focal: PrintFocal,
  framing: PrintFraming = PRINT_DEFAULT_FRAMING,
): PrintPhotoCrop {
  const { zoom, anchorX, anchorY } = printFraming(framing)
  const zoomedWidth = cover.widthPt * zoom
  const zoomedHeight = cover.heightPt * zoom
  // Points per photo pixel once the photo covers the zoomed box.
  const scale = Math.max(zoomedWidth / photo.widthPx, zoomedHeight / photo.heightPx)
  const fx = clamp(focal.x, 0, 1)
  const fy = clamp(focal.y, 0, 1)
  const left =
    (photo.widthPx * scale - zoomedWidth) * fx + (zoomedWidth - cover.widthPt) * anchorX
  const top =
    (photo.heightPx * scale - zoomedHeight) * fy +
    (zoomedHeight - cover.heightPt) * anchorY
  return {
    leftPx: left / scale,
    topPx: top / scale,
    widthPx: cover.widthPt / scale,
    heightPx: cover.heightPt / scale,
  }
}
