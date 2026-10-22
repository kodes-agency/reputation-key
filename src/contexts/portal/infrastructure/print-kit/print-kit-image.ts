// The pictures of a print, made ready for the page: the photo cropped to its
// band (today's file) or to an Immersive window at print resolution, the logo
// as a PNG. `sharp` is the only decoder, as
// it is for uploads (it is external to the bundle for the same reason: a native
// binding that resolves from `node_modules`), and it is imported when a print is
// made, not when the process starts: the worker reaches this module through the
// container and never decodes an image for a print.

import type { OutputInfo, OverlayOptions } from 'sharp'
import { parseHexColour } from '#/shared/domain/portal-field-colour'
import { photoDim } from '#/shared/domain/portal-print-kit-immersive'
import { printedDpi, ptToIn } from '#/shared/domain/portal-print-kit-measures'

async function sharpFactory() {
  const { default: sharp } = await import('sharp')
  return sharp
}

/** Dots per inch of the photo as printed: what a print shop asks for. */
const PRINT_DPI = 300
const MM_PER_INCH = 25.4
const JPEG_QUALITY = 88

const pixelsFor = (millimetres: number) =>
  Math.round((millimetres / MM_PER_INCH) * PRINT_DPI)

export type PhotoBox = Readonly<{
  widthMm: number
  heightMm: number
  /**
   * Where the photo sits in its box, 0 to 1 across and down, as CSS
   * `object-position` places it (the preview and the guest page do): 0 shows the
   * photo's left or top edge, 1 its right or bottom, and 0.5 the middle.
   */
  focalX: number
  focalY: number
}>

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), high)

type Cover = Readonly<{
  /** The crop at print resolution, as raw RGB. */
  raw: Readonly<{ data: Buffer; info: OutputInfo }>
  /** How many of the photo's own pixels the crop spans across. */
  sourceWidth: number
}>

/**
 * The photo covering `width` × `height` pixels, placed by its focal point the
 * way the preview and the guest page place it: the crop sits `focal` of the way
 * along what overflows the box. (Centring the focal point instead agrees at 0,
 * 0.5 and 1 and drifts between: the printed card showed another part of the
 * photo than the one the manager approved.) A photo smaller than the box is
 * enlarged to cover it, as the page does.
 */
async function coverCrop(
  bytes: Uint8Array,
  size: Readonly<{ width: number; height: number }>,
  focal: Readonly<{ focalX: number; focalY: number }>,
): Promise<Cover> {
  const { width, height } = size
  const sharp = await sharpFactory()
  const source = sharp(bytes).rotate()
  const { width: sourceWidth = 0, height: sourceHeight = 0 } = await source.metadata()
  if (sourceWidth === 0 || sourceHeight === 0) throw new Error('unsupported image format')
  const scale = Math.max(width / sourceWidth, height / sourceHeight)
  const scaledWidth = Math.max(width, Math.round(sourceWidth * scale))
  const scaledHeight = Math.max(height, Math.round(sourceHeight * scale))
  const left = clamp(
    Math.round((scaledWidth - width) * focal.focalX),
    0,
    scaledWidth - width,
  )
  const top = clamp(
    Math.round((scaledHeight - height) * focal.focalY),
    0,
    scaledHeight - height,
  )
  const raw = await source
    .resize(scaledWidth, scaledHeight)
    .extract({ left, top, width, height })
    .flatten({ background: '#000000' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { raw, sourceWidth: width / scale }
}

async function jpegOf(cover: Cover, overlay?: OverlayOptions): Promise<Buffer> {
  const sharp = await sharpFactory()
  const { data, info } = cover.raw
  const image = sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
  return (overlay === undefined ? image : image.composite([overlay]))
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer()
}

/** The photo covering `box`, as a JPEG, placed by its focal point (`coverCrop`). */
export async function coverPhotoJpeg(bytes: Uint8Array, box: PhotoBox): Promise<Buffer> {
  const size = { width: pixelsFor(box.widthMm), height: pixelsFor(box.heightMm) }
  return jpegOf(await coverCrop(bytes, size, box))
}

/** Every this many pixels across and down is read for a crop's mean luminance: plenty for a mean. */
const LUMINANCE_STRIDE = 4

/** The mean relative luminance of a raw RGB crop, 0 to 1. */
export function meanLuminance(
  data: Uint8Array,
  info: Readonly<{ width: number; height: number; channels: number }>,
): number {
  let total = 0
  let count = 0
  for (let y = 0; y < info.height; y += LUMINANCE_STRIDE) {
    for (let x = 0; x < info.width; x += LUMINANCE_STRIDE) {
      const at = (y * info.width + x) * info.channels
      total +=
        0.2126 * linear(data[at] ?? 0) +
        0.7152 * linear(data[at + 1] ?? 0) +
        0.0722 * linear(data[at + 2] ?? 0)
      count += 1
    }
  }
  return count === 0 ? 0 : total / count
}

export type WindowPhotoBox = Readonly<{
  /** The picture inside the window's frame, in points. */
  widthPt: number
  heightPt: number
  focalX: number
  focalY: number
  /** The field colour the dim is painted in. */
  field: string
}>

export type WindowPhoto = Readonly<{
  bytes: Buffer
  /** How strongly it was dimmed in the field colour, 0 to 0.45. */
  dim: number
  /** The dots per inch of the photo's own pixels as printed: under 150 it prints soft. */
  dpi: number
}>

/**
 * The photo for an Immersive window (spec 3.2 and 5.2): cropped to the picture's
 * own shape, which differs between the 4 × 6 in and A6 windows and with the fit,
 * placed by its focal point; then dimmed in the field colour by how light the
 * crop is, baked into the JPEG, so white type near it holds whatever the photo.
 */
export async function windowPhotoJpeg(
  bytes: Uint8Array,
  box: WindowPhotoBox,
): Promise<WindowPhoto> {
  const size = {
    width: Math.max(1, Math.round(ptToIn(box.widthPt) * PRINT_DPI)),
    height: Math.max(1, Math.round(ptToIn(box.heightPt) * PRINT_DPI)),
  }
  const cover = await coverCrop(bytes, size, box)
  const dim = photoDim(meanLuminance(cover.raw.data, cover.raw.info))
  const [r, g, b] = parseHexColour(box.field) ?? [0, 0, 0]
  const veil = await (
    await sharpFactory()
  )({
    create: { ...size, channels: 4, background: { r, g, b, alpha: dim } },
  })
    .png()
    .toBuffer()
  return {
    bytes: await jpegOf(cover, { input: veil }),
    dim,
    dpi: printedDpi(cover.sourceWidth, box.widthPt),
  }
}

export type LogoImage = Readonly<{ bytes: Buffer; width: number; height: number }>

/** The logo as a PNG, which keeps its transparency in a PDF. */
export async function logoPng(bytes: Uint8Array): Promise<LogoImage> {
  const sharp = await sharpFactory()
  const { data, info } = await sharp(bytes)
    .rotate()
    .png()
    .toBuffer({ resolveWithObject: true })
  return { bytes: data, width: info.width, height: info.height }
}

/** An alpha this low is the soft edge of a transparent margin, not the drawing. */
const INK_ALPHA = 8

export type LogoInk = Readonly<{
  /** How much of the image, as a share of its height or width, is transparent above and left of the drawing. */
  top: number
  left: number
  /** The drawing's relative luminance, weighted by alpha, 0 to 1; null for an empty image. */
  luminance: number | null
}>

const linear = (channel: number) => {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/**
 * Where a logo's drawing starts inside its file, and how light it is. Logos are
 * supplied with transparent margins (the boards' have 1.2 mm of it at the top),
 * and the margins are measured to ink, so the face places the drawing, not the
 * file. The luminance says whether the logo needs a plate to print on paper.
 */
export function logoInk(
  pixels: Uint8Array,
  size: Readonly<{ width: number; height: number; channels: number }>,
): LogoInk {
  const { width, height, channels } = size
  let top = height
  let left = width
  let weight = 0
  let light = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * channels
      const alpha = channels === 4 ? (pixels[at + 3] ?? 0) : 255
      if (alpha <= INK_ALPHA) continue
      top = Math.min(top, y)
      left = Math.min(left, x)
      const luminance =
        0.2126 * linear(pixels[at] ?? 0) +
        0.7152 * linear(pixels[at + 1] ?? 0) +
        0.0722 * linear(pixels[at + 2] ?? 0)
      weight += alpha
      light += luminance * alpha
    }
  }
  if (weight === 0) return { top: 0, left: 0, luminance: null }
  return { top: top / height, left: left / width, luminance: light / weight }
}

export type LogoArt = LogoImage & Readonly<{ ink: LogoInk }>

/** The logo as a PNG, with where its drawing starts and how light it is. */
export async function logoArt(bytes: Uint8Array): Promise<LogoArt> {
  const sharp = await sharpFactory()
  const [image, raw] = await Promise.all([
    logoPng(bytes),
    sharp(bytes).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ])
  return { ...image, ink: logoInk(raw.data, raw.info) }
}
