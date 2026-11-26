// How an Immersive print crops its photo (design spec §6.2): cover its box with
// bleed at the property's focal point. Shared so the PDF crops the pixels the
// preview shows.

import type { PrintPhotoPixels } from './portal-print-photo'

const clamp = (value: number, low: number, high: number) =>
  Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : low

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
 * and tall (the box with its bleed), at `focal`. The focal
 * point places the crop as the guest page's `object-position` does: the crop
 * sits `focal` of the way along what overflows.
 */
export function printPhotoCrop(
  photo: PrintPhotoPixels,
  cover: Readonly<{ widthPt: number; heightPt: number }>,
  focal: PrintFocal,
): PrintPhotoCrop {
  // Points per photo pixel once the photo covers the box.
  const scale = Math.max(cover.widthPt / photo.widthPx, cover.heightPt / photo.heightPx)
  const fx = clamp(focal.x, 0, 1)
  const fy = clamp(focal.y, 0, 1)
  const left = (photo.widthPx * scale - cover.widthPt) * fx
  const top = (photo.heightPx * scale - cover.heightPt) * fy
  return {
    leftPx: left / scale,
    topPx: top / scale,
    widthPx: cover.widthPt / scale,
    heightPx: cover.heightPt / scale,
  }
}
