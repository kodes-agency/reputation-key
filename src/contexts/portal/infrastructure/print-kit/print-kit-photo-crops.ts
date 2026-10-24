// The property's photo cropped for every shape a print's layouts made, each
// shape cropped and embedded once (a window or band of one size shares a
// crop), and a print whose softest crop falls below the resolution a print
// needs reported once, without stopping the print. A print may also name a
// resolution under which it is refused: the card bands do (round-2 S6).

import { PHOTO_MIN_DPI } from '#/shared/domain/portal-print-kit-immersive'
import { PrintKitRenderRefusal } from '../../application/ports/portal-print-kit-renderer.port'
import type { PrintKitWarning } from './print-kit-pages'
import { openImage, type OpenedImage } from './print-kit-pdf-image'

export type PhotoCrop = Readonly<{ bytes: Buffer; dpi: number }>

/** One layout's crop: the key its shape shares, and how to make it. */
export type PhotoCropJob = Readonly<{ key: string; crop: () => Promise<PhotoCrop> }>

/** Under `warnBelow` dots per inch a print is reported; under `refuseBelow`, when named, it is refused. */
export type PhotoDpiLimits = Readonly<{ warnBelow: number; refuseBelow: number | null }>

const WINDOW_LIMITS: PhotoDpiLimits = { warnBelow: PHOTO_MIN_DPI, refuseBelow: null }

export async function cropPhotoOnce<Layout>(
  doc: PDFKit.PDFDocument,
  layouts: Iterable<Layout>,
  jobOf: (layout: Layout) => PhotoCropJob | null,
  warn: (warning: PrintKitWarning) => void,
  limits: PhotoDpiLimits = WINDOW_LIMITS,
): Promise<ReadonlyMap<string, OpenedImage>> {
  const photos = new Map<string, OpenedImage>()
  let lowestDpi = Number.POSITIVE_INFINITY
  for (const layout of layouts) {
    const job = jobOf(layout)
    if (job === null || photos.has(job.key)) continue
    const crop = await job.crop()
    lowestDpi = Math.min(lowestDpi, crop.dpi)
    photos.set(job.key, openImage(doc, crop.bytes))
  }
  if (limits.refuseBelow !== null && lowestDpi < limits.refuseBelow) {
    throw new PrintKitRenderRefusal({
      code: 'print_photo_too_soft',
      dpi: Math.round(lowestDpi),
      minimumDpi: limits.refuseBelow,
    })
  }
  if (lowestDpi < limits.warnBelow) {
    warn({
      message: 'The print kit photo prints below the resolution a print needs',
      context: { dpi: Math.round(lowestDpi), minimumDpi: limits.warnBelow },
    })
  }
  return photos
}
