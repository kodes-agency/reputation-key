import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { coverPhotoJpeg, logoPng } from './print-kit-image'

/** A 400 x 200 picture: the left half red, the right half blue. */
async function twoHalves(): Promise<Buffer> {
  const left = await sharp({
    create: { width: 200, height: 200, channels: 3, background: '#ff0000' },
  })
    .png()
    .toBuffer()
  const right = await sharp({
    create: { width: 200, height: 200, channels: 3, background: '#0000ff' },
  })
    .png()
    .toBuffer()
  return sharp({
    create: { width: 400, height: 200, channels: 3, background: '#000000' },
  })
    .composite([
      { input: left, left: 0, top: 0 },
      { input: right, left: 200, top: 0 },
    ])
    .webp({ lossless: true })
    .toBuffer()
}

async function centreColour(jpeg: Buffer): Promise<readonly [number, number, number]> {
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true })
  const index =
    (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) *
    info.channels
  return [data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0]
}

describe('coverPhotoJpeg', () => {
  it('crops to the box at the print resolution', async () => {
    const jpeg = await coverPhotoJpeg(await twoHalves(), {
      widthMm: 50,
      heightMm: 50,
      focalX: 0.5,
      focalY: 0.5,
    })
    const info = await sharp(jpeg).metadata()
    expect(info.format).toBe('jpeg')
    // 50 mm at 300 dpi.
    expect(info.width).toBe(591)
    expect(info.height).toBe(591)
  })

  it('keeps the focal point in the frame', async () => {
    const source = await twoHalves()
    const box = { widthMm: 25, heightMm: 25, focalX: 0, focalY: 0.5 }
    const [leftRed, , leftBlue] = await centreColour(await coverPhotoJpeg(source, box))
    expect(leftRed).toBeGreaterThan(200)
    expect(leftBlue).toBeLessThan(60)
    const [rightRed, , rightBlue] = await centreColour(
      await coverPhotoJpeg(source, { ...box, focalX: 1 }),
    )
    expect(rightRed).toBeLessThan(60)
    expect(rightBlue).toBeGreaterThan(200)
  })

  it('refuses bytes that are not an image', async () => {
    await expect(
      coverPhotoJpeg(Buffer.from('not an image'), {
        widthMm: 10,
        heightMm: 10,
        focalX: 0.5,
        focalY: 0.5,
      }),
    ).rejects.toThrow(/input buffer|unsupported image format/iu)
  })
})

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
