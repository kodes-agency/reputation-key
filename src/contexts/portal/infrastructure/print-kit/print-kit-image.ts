// The pictures of a print, made ready for the page: the photo cropped to an
// Immersive window at print resolution, the logo as a PNG. `sharp` is the only
// decoder, as it is for uploads (it is external to the bundle for the same
// reason: a native binding that resolves from `node_modules`), and it is
// imported when a print is made, not when the process starts: the worker reaches
// this module through the container and never decodes an image for a print.

async function sharpFactory() {
  const { default: sharp } = await import('sharp')
  return sharp
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
  /** Where the drawing ends, as a share of the image's height or width: 1 when it runs to the edge. */
  bottom: number
  right: number
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
  let bottom = -1
  let right = -1
  let weight = 0
  let light = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * channels
      const alpha = channels === 4 ? (pixels[at + 3] ?? 0) : 255
      if (alpha <= INK_ALPHA) continue
      top = Math.min(top, y)
      left = Math.min(left, x)
      bottom = Math.max(bottom, y)
      right = Math.max(right, x)
      const luminance =
        0.2126 * linear(pixels[at] ?? 0) +
        0.7152 * linear(pixels[at + 1] ?? 0) +
        0.0722 * linear(pixels[at + 2] ?? 0)
      weight += alpha
      light += luminance * alpha
    }
  }
  if (weight === 0) return { top: 0, left: 0, bottom: 1, right: 1, luminance: null }
  return {
    top: top / height,
    left: left / width,
    bottom: (bottom + 1) / height,
    right: (right + 1) / width,
    luminance: light / weight,
  }
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
