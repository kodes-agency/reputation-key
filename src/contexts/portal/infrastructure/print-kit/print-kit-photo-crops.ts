// The property's photo cropped for every shape a print's layouts made, each
// shape cropped and embedded once (a window or band of one size shares a
// crop), and a print whose softest crop falls below the resolution a print
// needs reported once, without stopping the print.

import { PHOTO_MIN_DPI } from '#/shared/domain/portal-print-kit-immersive'
import type { PrintKitWarning } from './print-kit-pages'
import { openImage, type OpenedImage } from './print-kit-pdf-image'

export type PhotoCrop = Readonly<{ bytes: Buffer; dpi: number }>

/** One layout's crop: the key its shape shares, and how to make it. */
export type PhotoCropJob = Readonly<{ key: string; crop: () => Promise<PhotoCrop> }>

export async function cropPhotoOnce<Layout>(
  doc: PDFKit.PDFDocument,
  layouts: Iterable<Layout>,
  jobOf: (layout: Layout) => PhotoCropJob | null,
  warn: (warning: PrintKitWarning) => void,
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
  if (lowestDpi < PHOTO_MIN_DPI) {
    warn({
      message: 'The print kit photo prints below the resolution a print needs',
      context: { dpi: Math.round(lowestDpi), minimumDpi: PHOTO_MIN_DPI },
    })
  }
  return photos
}
