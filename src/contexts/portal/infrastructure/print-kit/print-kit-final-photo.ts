// The pictures of an Immersive final print, made ready for the page (final
// design spec §4, §6.1 and §6.2): the photo decoded small to be read (the
// ground, the kicker, every word's contrast), the photo cropped to cover its
// box with bleed under the manager's framing, with its fade as a soft mask, and
// the logo read for how light its ink is. `sharp` decodes, imported when a
// print is made, as for today's kit.

import type { PrintFinalArt } from '#/shared/domain/portal-print-final-art'
import {
  PRINT_FINAL_LOGO_TONE_SIZE_PX,
  printFinalMedianInkLuminance,
} from '#/shared/domain/portal-print-final-brand'
import type { PrintFinalScenePhoto } from '#/shared/domain/portal-print-final-contrast'
import {
  printFinalPhotoCrop,
  type PrintFinalFraming,
} from '#/shared/domain/portal-print-final-framing'
import {
  PRINT_FINAL_DETAIL_WIDTH_PX,
  PRINT_FINAL_SAMPLE_WIDTH_PX,
  type PrintFinalPhotoSample,
} from '#/shared/domain/portal-print-final-photo-sample'
import type { PrintKitPhoto } from '../../application/ports/portal-print-kit-renderer.port'
import { jpegImage, rampMask, type PdfRasterImage } from './print-kit-final-raster'

async function sharpFactory() {
  const { default: sharp } = await import('sharp')
  return sharp
}

/** The photo prints at this many dots per inch at most: what a print shop asks for. */
const PRINT_DPI = 300
const JPEG_QUALITY = 88
/** EXIF orientations 5 to 8 turn the picture a quarter: its width and height swap. */
const QUARTER_TURN_ORIENTATION = 5

/** The photo as a face reads it: its sample, its own size as shown upright, its focal point and framing. */
export async function finalScenePhoto(
  photo: PrintKitPhoto,
  framing: PrintFinalFraming,
): Promise<PrintFinalScenePhoto> {
  const sharp = await sharpFactory()
  const meta = await sharp(photo.bytes).metadata()
  const { width = 0, height = 0, orientation = 1 } = meta
  if (width === 0 || height === 0) throw new Error('unsupported image format')
  const turned = orientation >= QUARTER_TURN_ORIENTATION
  const decode = async (widthPx: number): Promise<PrintFinalPhotoSample> => {
    const { data, info } = await sharp(photo.bytes)
      .rotate()
      .resize({ width: widthPx })
      .flatten({ background: '#000000' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    return { widthPx: info.width, heightPx: info.height, rgb: data }
  }
  return {
    sample: await decode(PRINT_FINAL_SAMPLE_WIDTH_PX),
    detail: await decode(Math.min(PRINT_FINAL_DETAIL_WIDTH_PX, turned ? height : width)),
    pixels: { widthPx: turned ? height : width, heightPx: turned ? width : height },
    focal: { x: photo.focalX, y: photo.focalY },
    framing,
  }
}

const clampInt = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, Math.round(value)))

/**
 * The photo as the face draws it: the part that covers the art's cover box
 * under the framing, at up to 300 dpi (never more pixels than the crop has),
 * as a JPEG whose soft mask is the fade.
 */
export async function finalPhotoImage(
  doc: PDFKit.PDFDocument,
  bytes: Uint8Array,
  scene: PrintFinalScenePhoto,
  photo: NonNullable<PrintFinalArt['photo']>,
): Promise<PdfRasterImage> {
  const { cover } = photo
  const coverWidth = cover.rightPt - cover.leftPt
  const coverHeight = cover.bottomPt - cover.topPt
  const crop = printFinalPhotoCrop(
    scene.pixels,
    { widthPt: coverWidth, heightPt: coverHeight },
    scene.focal,
    scene.framing,
  )
  const { widthPx, heightPx } = scene.pixels
  const left = clampInt(crop.leftPx, 0, widthPx - 1)
  const top = clampInt(crop.topPx, 0, heightPx - 1)
  const region = {
    left,
    top,
    width: clampInt(crop.widthPx, 1, widthPx - left),
    height: clampInt(crop.heightPx, 1, heightPx - top),
  }
  const width = Math.max(
    1,
    Math.min(region.width, Math.round((coverWidth / 72) * PRINT_DPI)),
  )
  const height = Math.max(1, Math.round((width * coverHeight) / coverWidth))
  const sharp = await sharpFactory()
  const jpeg = await sharp(bytes)
    .rotate()
    .extract(region)
    .resize(width, height, { fit: 'fill' })
    .flatten({ background: '#000000' })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer()
  return jpegImage(
    doc,
    { bytes: jpeg, width, height },
    rampMask(doc, [photo.fade], cover),
  )
}

/** The median luminance of a logo's drawn pixels, read at most 200 px across; null when nothing is drawn. */
export async function finalLogoTone(bytes: Uint8Array): Promise<number | null> {
  const sharp = await sharpFactory()
  const { data, info } = await sharp(bytes)
    .rotate()
    .ensureAlpha()
    .resize(PRINT_FINAL_LOGO_TONE_SIZE_PX, PRINT_FINAL_LOGO_TONE_SIZE_PX, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .raw()
    .toBuffer({ resolveWithObject: true })
  return printFinalMedianInkLuminance(data, info)
}
