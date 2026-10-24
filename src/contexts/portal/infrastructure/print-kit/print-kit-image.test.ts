import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { inToPt, mmToPt } from '#/shared/domain/portal-print-kit-measures'
import {
  logoArt,
  logoInk,
  logoPng,
  meanLuminance,
  windowPhotoJpeg,
} from './print-kit-image'

/**
 * A grey picture that lightens along one axis, from black to `peak`: the value
 * at a pixel is its share of the way along, so the centre of a crop says which
 * part of the picture it holds. A low `peak` keeps the crop dark enough to be
 * left undimmed.
 */
async function gradient(
  width: number,
  height: number,
  along: 'x' | 'y',
  peak = 255,
): Promise<Buffer> {
  const length = along === 'x' ? width : height
  const raw = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = Math.round(((along === 'x' ? x : y) / (length - 1)) * peak)
      raw.fill(value, (y * width + x) * 3, (y * width + x) * 3 + 3)
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer()
}

describe('logoPng', () => {
  it('re-encodes the logo as PNG, keeping its shape', async () => {
    const webp = await sharp({
      create: {
        width: 120,
        height: 30,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .webp()
      .toBuffer()
    const logo = await logoPng(webp)
    expect(logo.width).toBe(120)
    expect(logo.height).toBe(30)
    expect((await sharp(logo.bytes).metadata()).format).toBe('png')
  })
})

/** A 200 × 100 logo: `colour` from row `top` and column `left` down and right, transparent above and left of it. */
async function logoWithEdge(colour: string, top: number, left: number): Promise<Buffer> {
  const drawing = await sharp({
    create: { width: 200 - left, height: 100 - top, channels: 4, background: colour },
  })
    .png()
    .toBuffer()
  return sharp({
    create: {
      width: 200,
      height: 100,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: drawing, top, left }])
    .png()
    .toBuffer()
}

describe('logoInk', () => {
  it('finds where the drawing starts past a transparent edge, as a share of the file', async () => {
    const art = await logoArt(await logoWithEdge('#202020', 10, 30))
    expect(art.ink.top).toBeCloseTo(0.1, 6)
    expect(art.ink.left).toBeCloseTo(0.15, 6)
    expect([art.width, art.height]).toEqual([200, 100])
  })

  it('reads how light the drawing is, ignoring what is transparent', async () => {
    const dark = await logoArt(await logoWithEdge('#121614', 10, 0))
    const cream = await logoArt(await logoWithEdge('#F6F1E6', 10, 0))
    expect(dark.ink.luminance).toBeLessThan(0.02)
    expect(cream.ink.luminance).toBeGreaterThan(0.85)
  })

  it('has no luminance and no edge for an empty image', () => {
    const empty = new Uint8Array(4 * 4 * 4)
    expect(logoInk(empty, { width: 4, height: 4, channels: 4 })).toEqual({
      top: 0,
      left: 0,
      bottom: 1,
      right: 1,
      luminance: null,
    })
  })

  it('measures where the drawing ends as well as where it starts', () => {
    // A 4 × 4 image whose drawing covers columns 1–2 of row 1 only.
    const pixels = new Uint8Array(4 * 4 * 4)
    for (const x of [1, 2]) pixels.set([0, 0, 0, 255], (1 * 4 + x) * 4)
    expect(logoInk(pixels, { width: 4, height: 4, channels: 4 })).toMatchObject({
      top: 0.25,
      left: 0.25,
      bottom: 0.5,
      right: 0.75,
    })
  })

  it('treats a file with no alpha as all drawing', () => {
    const white = new Uint8Array(3 * 2 * 2).fill(255)
    expect(logoInk(white, { width: 2, height: 2, channels: 3 })).toEqual({
      top: 0,
      left: 0,
      bottom: 1,
      right: 1,
      luminance: 1,
    })
  })
})

/** A flat picture of one colour, as a JPEG. */
const flat = (width: number, height: number, colour: string) =>
  sharp({ create: { width, height, channels: 3, background: colour } })
    .jpeg()
    .toBuffer()

const centreOf = async (jpeg: Buffer) => {
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true })
  const at = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 3
  return { width: info.width, height: info.height, rgb: [...data.subarray(at, at + 3)] }
}

describe('windowPhotoJpeg', () => {
  const window4x6 = {
    widthPt: inToPt(3.32),
    heightPt: inToPt(0.61),
    focalX: 0.5,
    focalY: 0.94,
  }

  it('crops the photo to the window’s own shape at 300 dpi: the 4 × 6 in and A6 windows differ', async () => {
    const photo = await flat(1600, 1067, '#204060')
    const card = await windowPhotoJpeg(photo, { ...window4x6, field: '#16130E' })
    const a6 = await windowPhotoJpeg(photo, {
      widthPt: (88 * 72) / 25.4,
      heightPt: (14.4 * 72) / 25.4,
      focalX: 0.5,
      focalY: 0.5,
      field: '#16130E',
    })
    expect(await centreOf(card.bytes)).toMatchObject({ width: 996, height: 183 })
    expect(await centreOf(a6.bytes)).toMatchObject({ width: 1039, height: 170 })
  })

  it('places the crop by its focal point, as the page’s object-position does', async () => {
    const photo = await gradient(400, 400, 'y')
    const bottom = await windowPhotoJpeg(photo, {
      ...window4x6,
      focalY: 1,
      field: '#000000',
    })
    const top = await windowPhotoJpeg(photo, {
      ...window4x6,
      focalY: 0,
      field: '#000000',
    })
    const [bottomGrey = 0] = (await centreOf(bottom.bytes)).rgb
    const [topGrey = 0] = (await centreOf(top.bytes)).rgb
    expect(bottomGrey).toBeGreaterThan(topGrey + 100)
  })

  // A 25 mm window is 295 px at 300 dpi. A 400 x 100 picture is enlarged to 1180 x
  // 295 to cover it, so 885 px overflow across, and the crop's centre is its left
  // edge plus 147 px. At focal 0.2 the crop starts 177 px in (its centre is 110 of
  // the picture's 400 px); at 0.8, 708 px in (290 px). Centring the focal point
  // instead would give 51 and 204 of 255. The picture peaks at 100, so every crop
  // is dark enough to stay undimmed and the centre's value says where it was cut.
  it.each([
    [0.2, 28],
    [0.8, 73],
  ])(
    'places the photo across its window at focal %s as CSS object-position does',
    async (focalX, expected) => {
      const { bytes } = await windowPhotoJpeg(await gradient(400, 100, 'x', 100), {
        widthPt: mmToPt(25),
        heightPt: mmToPt(25),
        focalX,
        focalY: 0.5,
        field: '#000000',
      })
      const [grey = 0] = (await centreOf(bytes)).rgb
      expect(Math.abs(grey - expected)).toBeLessThanOrEqual(5)
    },
  )

  it.each([
    [0.2, 28],
    [0.8, 73],
  ])(
    'places the photo down its window at focal %s as CSS object-position does',
    async (focalY, expected) => {
      const { bytes } = await windowPhotoJpeg(await gradient(100, 400, 'y', 100), {
        widthPt: mmToPt(25),
        heightPt: mmToPt(25),
        focalX: 0.5,
        focalY,
        field: '#000000',
      })
      const [grey = 0] = (await centreOf(bytes)).rgb
      expect(Math.abs(grey - expected)).toBeLessThanOrEqual(5)
    },
  )

  it('refuses bytes that are not an image', async () => {
    await expect(
      windowPhotoJpeg(Buffer.from('not an image'), { ...window4x6, field: '#16130E' }),
    ).rejects.toThrow(/input buffer|unsupported image format/iu)
  })

  it('leaves a dark crop undimmed, and dims a light one in the field colour', async () => {
    const dark = await windowPhotoJpeg(await flat(800, 400, '#202020'), {
      ...window4x6,
      field: '#16130E',
    })
    expect(dark.dim).toBe(0)
    const light = await windowPhotoJpeg(await flat(800, 400, '#FFFFFF'), {
      ...window4x6,
      field: '#16130E',
    })
    expect(light.dim).toBeCloseTo(0.45, 2)
    const [r = 0] = (await centreOf(light.bytes)).rgb
    // White under the field at 0.45: about 255 - 0.45 × (255 - 22).
    expect(r).toBeGreaterThan(140)
    expect(r).toBeLessThan(160)
  })

  it('says how many of the photo’s own pixels an inch prints: a small photo prints soft', async () => {
    const small = await windowPhotoJpeg(await flat(300, 200, '#405060'), {
      ...window4x6,
      field: '#16130E',
    })
    expect(small.dpi).toBeCloseTo(300 / 3.32, 0)
    const large = await windowPhotoJpeg(await flat(2400, 1600, '#405060'), {
      ...window4x6,
      field: '#16130E',
    })
    expect(large.dpi).toBeGreaterThan(600)
  })
})

describe('meanLuminance', () => {
  it('reads black as 0, white as 1 and mid grey as its relative luminance', () => {
    const info = { width: 8, height: 8, channels: 3 }
    expect(meanLuminance(new Uint8Array(192).fill(0), info)).toBe(0)
    expect(meanLuminance(new Uint8Array(192).fill(255), info)).toBeCloseTo(1, 10)
    expect(meanLuminance(new Uint8Array(192).fill(128), info)).toBeCloseTo(0.2158, 3)
  })
})
