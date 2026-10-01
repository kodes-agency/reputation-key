// The pictures of a print, made ready for the page: the photo cropped to its
// band at print resolution, the logo as a PNG. `sharp` is the only decoder, as
// it is for uploads (it is external to the bundle for the same reason: a native
// binding that resolves from `node_modules`), and it is imported when a print is
// made, not when the process starts: the worker reaches this module through the
// container and never decodes an image for a print.

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
  /** Where the eye should land, 0 to 1 across and down; kept in the crop. */
  focalX: number
  focalY: number
}>

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), high)

/**
 * The photo covering `box`, as a JPEG, cropped so the focal point stays in
 * frame. A photo smaller than the box is enlarged to cover it, as the page does.
 */
export async function coverPhotoJpeg(bytes: Uint8Array, box: PhotoBox): Promise<Buffer> {
  const width = pixelsFor(box.widthMm)
  const height = pixelsFor(box.heightMm)
  const sharp = await sharpFactory()
  const source = sharp(bytes).rotate()
  const { width: sourceWidth = 0, height: sourceHeight = 0 } = await source.metadata()
  if (sourceWidth === 0 || sourceHeight === 0) throw new Error('unsupported image format')
  const scale = Math.max(width / sourceWidth, height / sourceHeight)
  const scaledWidth = Math.max(width, Math.round(sourceWidth * scale))
  const scaledHeight = Math.max(height, Math.round(sourceHeight * scale))
  const left = clamp(
    Math.round(box.focalX * scaledWidth - width / 2),
    0,
    scaledWidth - width,
  )
  const top = clamp(
    Math.round(box.focalY * scaledHeight - height / 2),
    0,
    scaledHeight - height,
  )
  return source
    .resize(scaledWidth, scaledHeight)
    .extract({ left, top, width, height })
    .flatten({ background: '#000000' })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer()
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
