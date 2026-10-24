// The property's photo cropped for the area each face shows it in (a card's
// band across the top, a small tent's panel down the left), with the bleed that
// face has where the page puts it: an office sheet's cards bleed on their outer
// edges only, and a tent never across its fold. Areas of one size share a crop,
// embedded once. Under 200 dpi a print is reported, and under 120 dpi refused
// (round-2 spec-delta S6), because an area that soft prints visibly blurred.

import { BAND_PHOTO_DPI } from '#/shared/domain/portal-print-kit-sizes'
import type { PrintKitPhoto } from '../../application/ports/portal-print-kit-renderer.port'
import { bandPhotoJpeg } from './print-kit-image'
import type { FaceBleed, PrintKitWarning } from './print-kit-pages'
import type { OpenedImage } from './print-kit-pdf-image'
import { cropPhotoOnce } from './print-kit-photo-crops'
import type { PrintKitPagePanel } from '#/shared/domain/portal-print-kit-sheets'

/** A photo area's size with its bleed, in points. */
export type PhotoArea = Readonly<{ widthPt: number; heightPt: number }>

/** The photo area of a laid-out face with its bleed; null where the face shows no photo. */
export type AreaOf<L> = (layout: L, bleed: FaceBleed) => PhotoArea | null

/** To the hundredth of a point: areas of one size share a crop. */
const keyOf = (area: PhotoArea): string =>
  `${area.widthPt.toFixed(2)}x${area.heightPt.toFixed(2)}`

/** The photo for a laid-out face with its bleed: its cropped image, or null for the monogram. */
export type PhotoAt<L> = (layout: L, bleed: FaceBleed) => OpenedImage | null

/** Crops the photo for every area the placed faces show, and says which crop each face draws. */
export async function areaPhotos<L>(
  doc: PDFKit.PDFDocument,
  photo: PrintKitPhoto | null,
  placed: readonly Readonly<{ panel: PrintKitPagePanel; layout: L }>[],
  areaOf: AreaOf<L>,
  warn: (warning: PrintKitWarning) => void,
): Promise<PhotoAt<L>> {
  if (photo === null) return () => null
  const photos = await cropPhotoOnce(
    doc,
    placed,
    ({ panel, layout }) => {
      const area = areaOf(layout, panel.bleed)
      if (area === null) return null
      const crop = () =>
        bandPhotoJpeg(photo.bytes, {
          ...area,
          focalX: photo.focalX,
          focalY: photo.focalY,
        })
      return { key: keyOf(area), crop }
    },
    warn,
    { warnBelow: BAND_PHOTO_DPI.warnBelow, refuseBelow: BAND_PHOTO_DPI.refuseBelow },
  )
  return (layout, bleed) => {
    const area = areaOf(layout, bleed)
    return area === null ? null : (photos.get(keyOf(area)) ?? null)
  }
}
