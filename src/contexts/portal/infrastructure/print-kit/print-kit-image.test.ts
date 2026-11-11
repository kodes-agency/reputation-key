import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { logoArt, logoInk, logoPng } from './print-kit-image'

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
