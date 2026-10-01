// The browser's half of choosing a picture: decode it to learn its real size
// (what the checks need) and make a small copy to look at while choosing. The
// page's CSP lets images load from `data:` but not from `blob:`, so the copy is
// a data address, drawn from a canvas at no more than a screen's worth of pixels
// rather than the 10 MB the person picked.
//
// The browser applies the picture's EXIF orientation when it decodes, as the
// server does before it measures, so the size here is the size the server sees.

/** The longest side of the copy made for looking at. */
export const PREVIEW_MAX_EDGE = 1200

const PREVIEW_QUALITY = 0.85

export type ReadImageOptions = Readonly<{
  /**
   * Keep the picture's transparency in the copy (a logo's is the point of it).
   * A photograph's copy is a JPEG, which is far smaller and has none.
   */
  keepTransparency?: boolean
}>

export type ReadImageResult =
  | Readonly<{ ok: true; width: number; height: number; previewUrl: string }>
  | Readonly<{ ok: false }>

/** The size of the copy: the picture scaled down to fit `maxEdge`, never up. */
export function previewSize(
  width: number,
  height: number,
  maxEdge: number = PREVIEW_MAX_EDGE,
): Readonly<{ width: number; height: number }> {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** Decodes a chosen file. Resolves, never rejects: a file the browser cannot read is `{ ok: false }`. */
export async function readImageFacts(
  file: Blob,
  { keepTransparency = false }: ReadImageOptions = {},
): Promise<ReadImageResult> {
  let bitmap: ImageBitmap | null = null
  try {
    // The orientation is stated, not left to the browser's default: the size must
    // be the one the server measures after it applies the same rotation.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const { width, height } = bitmap
    if (width < 1 || height < 1) return { ok: false }
    const copy = previewSize(width, height)
    const canvas = document.createElement('canvas')
    canvas.width = copy.width
    canvas.height = copy.height
    const context = canvas.getContext('2d')
    if (!context) return { ok: false }
    context.drawImage(bitmap, 0, 0, copy.width, copy.height)
    return {
      ok: true,
      width,
      height,
      previewUrl: keepTransparency
        ? canvas.toDataURL('image/png')
        : canvas.toDataURL('image/jpeg', PREVIEW_QUALITY),
    }
  } catch {
    return { ok: false }
  } finally {
    bitmap?.close()
  }
}
