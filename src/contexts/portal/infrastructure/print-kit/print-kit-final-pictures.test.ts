import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import type { PrintFinalArt } from '#/shared/domain/portal-print-final-art'
import { printFinalFraming } from '#/shared/domain/portal-print-final-framing'
import { newDocument } from './__fixtures__/print-kit-face-fixtures'
import { grainTile } from './print-kit-final-art'
import { finalLogoTone, finalPhotoImage, finalScenePhoto } from './print-kit-final-photo'
import { drawRaster, rampMask } from './print-kit-final-raster'

// The pictures an Immersive final face is made of, alone: the grain, the soft
// masks, the photo read and cropped, the logo's ink read.

const PHOTO_WIDTH = 1200
const PHOTO_HEIGHT = 700

/** A photo light at the top and dark at the foot. */
async function photo(orientation?: number): Promise<Uint8Array> {
  const raw = Buffer.alloc(PHOTO_WIDTH * PHOTO_HEIGHT * 3)
  for (let y = 0; y < PHOTO_HEIGHT; y++) {
    const level = Math.round(230 - (y / PHOTO_HEIGHT) * 180)
    for (let x = 0; x < PHOTO_WIDTH; x++)
      raw.set([level, level - 10, level - 20], (y * PHOTO_WIDTH + x) * 3)
  }
  const image = sharp(raw, {
    raw: { width: PHOTO_WIDTH, height: PHOTO_HEIGHT, channels: 3 },
  })
  return new Uint8Array(
    await (orientation === undefined ? image : image.withMetadata({ orientation }))
      .jpeg()
      .toBuffer(),
  )
}

/** A 100 × 40 px transparent logo with a 60 × 20 px drawing in `ink`, or nothing at all. */
async function logo(ink: string | null): Promise<Uint8Array> {
  const base = sharp({
    create: { width: 100, height: 40, channels: 4, background: '#00000000' },
  })
  const drawn =
    ink === null
      ? base
      : base.composite([
          {
            input: {
              create: { width: 60, height: 20, channels: 4, background: ink },
            },
            left: 20,
            top: 10,
          },
        ])
  return new Uint8Array(await drawn.png().toBuffer())
}

/** The PDF a drawing makes, uncompressed and dated; its trailer holds a random file id, so compare what comes before it. */
function pdfOf(draw: (doc: PDFKit.PDFDocument) => void): Promise<string> {
  const { doc } = newDocument()
  doc.info.CreationDate = new Date(0)
  const chunks: Buffer[] = []
  doc.on('data', (chunk: Buffer) => chunks.push(chunk))
  const done = new Promise<string>((resolve) => {
    doc.on('end', () =>
      resolve(Buffer.concat(chunks).toString('latin1').split('trailer')[0] ?? ''),
    )
  })
  draw(doc)
  doc.end()
  return done
}

const BOX = { leftPt: 0, topPt: 0, rightPt: 100, bottomPt: 50 }
const FADE = {
  axis: 'y',
  stops: [
    { atPt: 0, alpha: 1 },
    { atPt: 50, alpha: 0 },
  ],
} as const

describe('grainTile', () => {
  it('is the same every time, so a print can be made again', async () => {
    const draw = (doc: PDFKit.PDFDocument) => drawRaster(doc, grainTile(doc), BOX)
    const first = await pdfOf(draw)
    expect(first).toContain('/Width 128')
    expect(await pdfOf(draw)).toBe(first)
  })

  it('is a square of grey noise', () => {
    const { doc } = newDocument()
    expect(grainTile(doc)).toMatchObject({ width: 128, height: 128 })
  })
})

describe('rampMask', () => {
  const widths = (pdf: string) =>
    [...pdf.matchAll(/\/Width (\d+)\s+\/Height (\d+)/g)].map(
      (match) => [Number(match[1]), Number(match[2])] as const,
    )

  it('is one pixel thick along an axis no ramp changes along', async () => {
    const pdf = await pdfOf((doc) => {
      rampMask(doc, [FADE], BOX)
    })
    // A column 50 pt tall sampled every half point.
    expect(widths(pdf)).toContainEqual([1, 100])
  })
})

describe('finalScenePhoto', () => {
  const framing = printFinalFraming()

  it('reads the photo small for the ground and wider for each word', async () => {
    const scene = await finalScenePhoto(
      { bytes: await photo(), focalX: 0.5, focalY: 0.5 },
      framing,
    )
    expect(scene.sample.widthPx).toBe(240)
    expect(scene.detail.widthPx).toBe(960)
    expect(scene.pixels).toEqual({ widthPx: PHOTO_WIDTH, heightPx: PHOTO_HEIGHT })
  })

  it('turns the width and height of a photo that is stored on its side', async () => {
    const scene = await finalScenePhoto(
      { bytes: await photo(6), focalX: 0.5, focalY: 0.5 },
      framing,
    )
    expect(scene.pixels).toEqual({ widthPx: PHOTO_HEIGHT, heightPx: PHOTO_WIDTH })
  })

  it('refuses bytes that are not a picture', async () => {
    await expect(
      finalScenePhoto(
        { bytes: new Uint8Array([1, 2, 3]), focalX: 0.5, focalY: 0.5 },
        framing,
      ),
    ).rejects.toThrow(/unsupported image format/)
  })
})

describe('finalPhotoImage', () => {
  const shown: NonNullable<PrintFinalArt['photo']> = {
    box: BOX,
    cover: BOX,
    fade: FADE,
    clear: null,
    measure: { box: BOX, coverWidthPt: 100, coverHeightPt: 50 },
  }
  const artWith = (photo: NonNullable<PrintFinalArt['photo']>): PrintFinalArt => ({
    ground: '#202020',
    groundBox: BOX,
    washes: [],
    photo,
    scrims: [{ box: BOX, ramps: [FADE] }],
    arch: null,
    grainOpacity: 0,
    foldStrip: null,
  })

  it('crops to the cover box at 300 dpi at most', async () => {
    const bytes = await photo()
    const scene = await finalScenePhoto(
      { bytes, focalX: 0.5, focalY: 0.5 },
      printFinalFraming(),
    )
    const { doc } = newDocument()
    const image = await finalPhotoImage(doc, bytes, scene, artWith(shown))
    // 100 pt is 1.39 in: 417 px at 300 dpi, and as tall as the box's shape asks.
    expect(image?.width).toBe(417)
    expect(image?.height).toBe(209)
  })

  it('never has more pixels than the photo has to give', async () => {
    const bytes = await photo()
    const scene = await finalScenePhoto(
      { bytes, focalX: 0.5, focalY: 0.5 },
      printFinalFraming(),
    )
    const { doc } = newDocument()
    const wide = { ...shown, cover: { ...BOX, rightPt: 1000, bottomPt: 500 } }
    const image = await finalPhotoImage(
      doc,
      bytes,
      scene,
      artWith({
        ...wide,
        measure: { ...shown.measure, coverWidthPt: 1000, coverHeightPt: 500 },
      }),
    )
    expect(image?.width).toBeLessThanOrEqual(PHOTO_WIDTH)
  })

  it('is nothing for art with no photo', async () => {
    const bytes = await photo()
    const scene = await finalScenePhoto(
      { bytes, focalX: 0.5, focalY: 0.5 },
      printFinalFraming(),
    )
    const { doc } = newDocument()
    expect(
      await finalPhotoImage(doc, bytes, scene, { ...artWith(shown), photo: null }),
    ).toBeNull()
  })
})

describe('finalLogoTone', () => {
  it('is high for a light drawing and low for a dark one', async () => {
    expect(await finalLogoTone(await logo('#F6EAD2'))).toBeGreaterThanOrEqual(0.4)
    expect(await finalLogoTone(await logo('#232323'))).toBeLessThan(0.4)
  })

  it('is nothing for an image with nothing drawn', async () => {
    expect(await finalLogoTone(await logo(null))).toBeNull()
  })
})
