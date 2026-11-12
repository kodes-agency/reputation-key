// Shrink and re-encode a screenshot in the browser, so a reporter can attach a
// full-size capture as it is. The image is decoded, scaled to fit
// SCREENSHOT_MAX_EDGE_PX on its longer side and encoded again, stepping down
// quality and then size until it fits what the report may carry
// (`BETA_FEEDBACK_SCREENSHOT_MAX_BYTES`). Only pixels are drawn, so the file's
// metadata (camera, location, editing software) never leaves the browser.

import {
  BETA_FEEDBACK_SCREENSHOT_MAX_BYTES,
  type BetaFeedbackScreenshot,
  type BetaFeedbackScreenshotType,
} from '#/shared/beta-feedback-screenshot'

/** Decoding a larger file costs more memory than any screenshot needs. */
export const SCREENSHOT_MAX_INPUT_BYTES = 40 * 1024 * 1024

/** Tried in order until one fits: quality first, then size. */
export const ENCODE_ATTEMPTS: ReadonlyArray<
  Readonly<{ maxEdge: number; quality: number }>
> = [
  // 2,560 px keeps the text of a full-width laptop screenshot readable.
  { maxEdge: 2_560, quality: 0.9 },
  { maxEdge: 2_560, quality: 0.8 },
  { maxEdge: 2_048, quality: 0.8 },
  { maxEdge: 1_600, quality: 0.75 },
  { maxEdge: 1_280, quality: 0.7 },
  { maxEdge: 960, quality: 0.6 },
]

/** JPEG has no transparency, so a transparent area would otherwise turn black. */
const JPEG_BACKGROUND = '#ffffff'

type Size = Readonly<{ width: number; height: number }>

export type DecodedScreenshot = Size &
  Readonly<{
    source: CanvasImageSource
    /** Releases the decoded pixels. */
    close: () => void
  }>

/** The browser steps, injected so the ladder can be tested without a canvas. */
export type ScreenshotCodec = Readonly<{
  decode: (file: Blob) => Promise<DecodedScreenshot>
  encode: (
    image: DecodedScreenshot,
    size: Size,
    type: BetaFeedbackScreenshotType,
    quality: number,
  ) => Promise<Blob>
  toBase64: (blob: Blob) => Promise<string>
}>

export type PreparedScreenshot = Size &
  Readonly<{
    /** What the report sends. */
    screenshot: BetaFeedbackScreenshot
    /** The same bytes, for the preview. */
    blob: Blob
  }>

export type ScreenshotRefusal =
  'not_an_image' | 'too_large_to_read' | 'unreadable' | 'too_detailed'

export type ScreenshotPreparation =
  | Readonly<{ ok: true; prepared: PreparedScreenshot }>
  | Readonly<{ ok: false; reason: ScreenshotRefusal }>

/** Scale `size` down, never up, so its longer side is at most `maxEdge`. */
export function fitWithin(size: Size, maxEdge: number): Size {
  const longer = Math.max(size.width, size.height)
  if (longer <= maxEdge) return { width: size.width, height: size.height }
  const scale = maxEdge / longer
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  }
}

const refused = (reason: ScreenshotRefusal): ScreenshotPreparation => ({
  ok: false,
  reason,
})

async function encodeToFit(
  image: DecodedScreenshot,
  codec: ScreenshotCodec,
): Promise<ScreenshotPreparation> {
  let type: BetaFeedbackScreenshotType = 'image/webp'
  for (const attempt of ENCODE_ATTEMPTS) {
    const size = fitWithin(image, attempt.maxEdge)
    let blob = await codec.encode(image, size, type, attempt.quality)
    if (blob.type !== type) {
      // A browser that cannot encode WebP hands back PNG instead. Every
      // browser encodes JPEG, so it is used from here on.
      type = 'image/jpeg'
      blob = await codec.encode(image, size, type, attempt.quality)
      if (blob.type !== type) return refused('unreadable')
    }
    if (blob.size <= BETA_FEEDBACK_SCREENSHOT_MAX_BYTES) {
      const base64 = await codec.toBase64(blob)
      return {
        ok: true,
        prepared: { screenshot: { mediaType: type, base64 }, blob, ...size },
      }
    }
  }
  return refused('too_detailed')
}

export async function prepareScreenshot(
  file: Blob,
  codec: ScreenshotCodec = browserScreenshotCodec,
): Promise<ScreenshotPreparation> {
  if (!file.type.startsWith('image/')) return refused('not_an_image')
  if (file.size > SCREENSHOT_MAX_INPUT_BYTES) return refused('too_large_to_read')

  let image: DecodedScreenshot
  try {
    image = await codec.decode(file)
  } catch {
    return refused('unreadable')
  }
  try {
    return await encodeToFit(image, codec)
  } catch {
    return refused('unreadable')
  } finally {
    image.close()
  }
}

const browserScreenshotCodec: ScreenshotCodec = {
  decode: async (file) => {
    // Upright as the camera or editor meant it, whatever its EXIF says.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return {
      width: bitmap.width,
      height: bitmap.height,
      source: bitmap,
      close: () => bitmap.close(),
    }
  },
  encode: (image, size, type, quality) =>
    new Promise<Blob>((resolve, reject) => {
      const canvas = document.createElement('canvas')
      canvas.width = size.width
      canvas.height = size.height
      const context = canvas.getContext('2d')
      if (!context) {
        reject(new Error('Canvas 2D context unavailable'))
        return
      }
      if (type === 'image/jpeg') {
        context.fillStyle = JPEG_BACKGROUND
        context.fillRect(0, 0, size.width, size.height)
      }
      context.imageSmoothingQuality = 'high'
      context.drawImage(image.source, 0, 0, size.width, size.height)
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Image encoding failed'))),
        type,
        quality,
      )
    }),
  toBase64: (blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = String(reader.result)
        resolve(dataUrl.slice(dataUrl.indexOf(',') + 1))
      }
      reader.onerror = () => reject(reader.error ?? new Error('Image read failed'))
      reader.readAsDataURL(blob)
    }),
}
