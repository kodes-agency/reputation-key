// The PDF pieces an Immersive final face is painted with that PDFKit has no
// call for (final design spec §6.1 to §6.3): an image with a soft mask (the
// photo's fade, and each scrim as the scrim ink under its ramps), and film
// grain blended as overlay.
//
// A soft mask is a small grey image whose dimensions need not match the image
// it masks: both are mapped onto the drawn box. A ramp along one axis is one
// pixel thick, so a fade costs a few hundred bytes. PDFKit draws any object
// with a width, a height, a label and an `embed`, so these images go through
// `doc.image` like a photo; the overlay is an ExtGState registered on the page
// the way PDFKit registers its own opacity states. All of it is PDF 1.4.

import {
  layerAlpha,
  type PrintFinalRamp,
} from '#/shared/domain/portal-print-final-layers'
import type { PrintFinalBox } from '#/shared/domain/portal-print-final-measures'

/** What `doc.image` draws: PDFKit's own image objects have this shape. */
export type PdfRasterImage = {
  readonly width: number
  readonly height: number
  readonly label: string
  obj: PDFKit.PDFKitReference | null
  embed: (doc: PDFKit.PDFDocument) => void
}

const counters = new WeakMap<PDFKit.PDFDocument, number>()

/** A name no other image on the document has. */
function labelFor(doc: PDFKit.PDFDocument, prefix: string): string {
  const next = (counters.get(doc) ?? 0) + 1
  counters.set(doc, next)
  return `${prefix}${next}`
}

/** A mask sample every this many points along a ramp: smooth, and smoothed again by interpolation. */
const MASK_STEP_PT = 0.5
const MASK_MAX_PX = 1024

const pixelsAlong = (lengthPt: number): number =>
  Math.min(MASK_MAX_PX, Math.max(2, Math.ceil(lengthPt / MASK_STEP_PT)))

/**
 * A soft mask over `box` from its ramps: a grey image, one pixel thick along
 * an axis no ramp changes along, each pixel the ramps' product at its centre.
 */
export function rampMask(
  doc: PDFKit.PDFDocument,
  ramps: readonly PrintFinalRamp[],
  box: PrintFinalBox,
): PDFKit.PDFKitReference {
  const widthPt = box.rightPt - box.leftPt
  const heightPt = box.bottomPt - box.topPt
  const across = ramps.some((ramp) => ramp.axis === 'x') ? pixelsAlong(widthPt) : 1
  const down = ramps.some((ramp) => ramp.axis === 'y') ? pixelsAlong(heightPt) : 1
  const alphas = Buffer.alloc(across * down)
  for (let row = 0; row < down; row++) {
    const y = box.topPt + ((row + 0.5) / down) * heightPt
    for (let column = 0; column < across; column++) {
      const x = box.leftPt + ((column + 0.5) / across) * widthPt
      alphas[row * across + column] = Math.round(layerAlpha(ramps, x, y) * 255)
    }
  }
  const mask = doc.ref({
    Type: 'XObject',
    Subtype: 'Image',
    Width: across,
    Height: down,
    ColorSpace: 'DeviceGray',
    BitsPerComponent: 8,
    Interpolate: true,
  })
  mask.end(alphas)
  return mask
}

type ImageData = Readonly<{
  width: number
  height: number
  colourSpace: 'DeviceRGB' | 'DeviceGray'
  bytes: Buffer
  /** DCTDecode for a JPEG; none for raw samples, which PDFKit compresses. */
  filter: 'DCTDecode' | null
  mask: PDFKit.PDFKitReference | null
}>

function rasterImage(
  doc: PDFKit.PDFDocument,
  data: ImageData,
  prefix: string,
): PdfRasterImage {
  return {
    width: data.width,
    height: data.height,
    label: labelFor(doc, prefix),
    obj: null,
    embed(document) {
      if (this.obj !== null) return
      const obj = document.ref({
        Type: 'XObject',
        Subtype: 'Image',
        Width: data.width,
        Height: data.height,
        ColorSpace: data.colourSpace,
        BitsPerComponent: 8,
        ...(data.filter === null ? {} : { Filter: data.filter }),
        ...(data.mask === null ? {} : { SMask: data.mask }),
      })
      obj.end(data.bytes)
      this.obj = obj
    },
  }
}

/** A JPEG of `width` × `height` RGB pixels, masked by `mask` when given. */
export const jpegImage = (
  doc: PDFKit.PDFDocument,
  jpeg: Readonly<{ bytes: Buffer; width: number; height: number }>,
  mask: PDFKit.PDFKitReference | null,
): PdfRasterImage =>
  rasterImage(doc, { ...jpeg, colourSpace: 'DeviceRGB', filter: 'DCTDecode', mask }, 'Rp')

/** One pixel of `rgb`, under `mask`: a flat colour whose alpha the mask paints. */
export const maskedColour = (
  doc: PDFKit.PDFDocument,
  rgb: readonly [number, number, number],
  mask: PDFKit.PDFKitReference,
): PdfRasterImage =>
  rasterImage(
    doc,
    {
      width: 1,
      height: 1,
      colourSpace: 'DeviceRGB',
      bytes: Buffer.from(rgb),
      filter: null,
      mask,
    },
    'Rs',
  )

/** A grey image of raw samples. */
export const greyImage = (
  doc: PDFKit.PDFDocument,
  grey: Readonly<{ bytes: Buffer; width: number; height: number }>,
): PdfRasterImage =>
  rasterImage(doc, { ...grey, colourSpace: 'DeviceGray', filter: null, mask: null }, 'Rg')

export function drawRaster(
  doc: PDFKit.PDFDocument,
  image: PdfRasterImage,
  box: PrintFinalBox,
): void {
  // PDFKit draws any object shaped like its own images; its typings only say bytes.
  doc.image(image as unknown as Buffer, box.leftPt, box.topPt, {
    width: box.rightPt - box.leftPt,
    height: box.bottomPt - box.topPt,
  })
}

const overlayStates = new WeakMap<
  PDFKit.PDFDocument,
  Map<number, PDFKit.PDFKitReference>
>()

/** Paints what `draw` draws blended as overlay at `opacity`, as the boards' grain is. */
export function withOverlay(
  doc: PDFKit.PDFDocument,
  opacity: number,
  draw: () => void,
): void {
  const states = overlayStates.get(doc) ?? new Map<number, PDFKit.PDFKitReference>()
  overlayStates.set(doc, states)
  let state = states.get(opacity)
  if (state === undefined) {
    state = doc.ref({ Type: 'ExtGState', BM: 'Overlay', ca: opacity, CA: opacity })
    state.end('')
    states.set(opacity, state)
  }
  const name = `RkOverlay${String(opacity).replace('.', '_')}`
  doc.save()
  doc.page.ext_gstates[name] = state
  doc.addContent(`/${name} gs`)
  draw()
  doc.restore()
}
