import { describe, expect, it, vi } from 'vitest'
import { BETA_FEEDBACK_SCREENSHOT_MAX_BYTES } from '#/shared/beta-feedback-screenshot'
import {
  ENCODE_ATTEMPTS,
  fitWithin,
  prepareScreenshot,
  SCREENSHOT_MAX_INPUT_BYTES,
  type ScreenshotCodec,
} from './beta-feedback-screenshot-encode'

type Encoded = Readonly<{ type: string; size: number }>

/**
 * A codec that "encodes" to a blob whose size the test decides, so the retry
 * ladder can be walked without a canvas. `sizeFor` sees every attempt.
 */
function fakeCodec(
  image: Readonly<{ width: number; height: number }>,
  sizeFor: (attempt: { width: number; type: string; quality: number }) => Encoded,
) {
  const close = vi.fn()
  const attempts: Array<{
    width: number
    height: number
    type: string
    quality: number
  }> = []
  const codec: ScreenshotCodec = {
    decode: async () => ({ ...image, source: {} as CanvasImageSource, close }),
    encode: async (_image, size, type, quality) => {
      attempts.push({ ...size, type, quality })
      const out = sizeFor({ width: size.width, type, quality })
      return new Blob([new Uint8Array(out.size)], { type: out.type })
    },
    toBase64: async (blob) => Buffer.from(await blob.arrayBuffer()).toString('base64'),
  }
  return { codec, close, attempts }
}

const file = (type = 'image/png', size = 1_000) =>
  new Blob([new Uint8Array(size)], { type })

describe('fitting a screenshot', () => {
  it('scales the longer side down to the edge, keeping the shape', () => {
    expect(fitWithin({ width: 3_024, height: 1_964 }, 2_560)).toEqual({
      width: 2_560,
      height: 1_663,
    })
    expect(fitWithin({ width: 1_170, height: 2_532 }, 2_560)).toEqual({
      width: 1_170,
      height: 2_532,
    })
  })

  it('never enlarges a small image', () => {
    expect(fitWithin({ width: 800, height: 600 }, 2_560)).toEqual({
      width: 800,
      height: 600,
    })
  })
})

describe('preparing a screenshot', () => {
  it('sends a full-size retina screenshot as WebP on the first attempt that fits', async () => {
    const { codec, close, attempts } = fakeCodec({ width: 3_024, height: 1_964 }, () => ({
      type: 'image/webp',
      size: 400_000,
    }))

    const result = await prepareScreenshot(file(), codec)

    expect(result).toMatchObject({
      ok: true,
      prepared: { width: 2_560, height: 1_663, screenshot: { mediaType: 'image/webp' } },
    })
    expect(attempts).toHaveLength(1)
    expect(close).toHaveBeenCalledOnce()
  })

  it('gives up quality, then size, until the image fits', async () => {
    const fitsAt = ENCODE_ATTEMPTS[3]
    if (!fitsAt) throw new Error('expected a fourth attempt')
    const { codec, attempts } = fakeCodec({ width: 5_000, height: 3_000 }, (attempt) => ({
      type: 'image/webp',
      size:
        attempt.quality <= fitsAt.quality && attempt.width <= fitsAt.maxEdge
          ? BETA_FEEDBACK_SCREENSHOT_MAX_BYTES
          : BETA_FEEDBACK_SCREENSHOT_MAX_BYTES + 1,
    }))

    const result = await prepareScreenshot(file(), codec)

    expect(result).toMatchObject({ ok: true, prepared: { width: fitsAt.maxEdge } })
    expect(attempts.map(({ quality }) => quality)).toEqual(
      ENCODE_ATTEMPTS.slice(0, 4).map(({ quality }) => quality),
    )
  })

  it('uses JPEG where the browser cannot encode WebP', async () => {
    // Such a browser silently hands back PNG for a WebP request.
    const { codec, attempts } = fakeCodec({ width: 1_440, height: 900 }, ({ type }) => ({
      type: type === 'image/webp' ? 'image/png' : type,
      size: 300_000,
    }))

    const result = await prepareScreenshot(file(), codec)

    expect(result).toMatchObject({
      ok: true,
      prepared: { screenshot: { mediaType: 'image/jpeg' } },
    })
    expect(attempts.map(({ type }) => type)).toEqual(['image/webp', 'image/jpeg'])
  })

  it('refuses an image no attempt can fit, and still releases it', async () => {
    const { codec, close } = fakeCodec({ width: 4_000, height: 4_000 }, () => ({
      type: 'image/webp',
      size: BETA_FEEDBACK_SCREENSHOT_MAX_BYTES + 1,
    }))

    expect(await prepareScreenshot(file(), codec)).toEqual({
      ok: false,
      reason: 'too_detailed',
    })
    expect(close).toHaveBeenCalledOnce()
  })

  it.each([
    ['a file that is not an image', file('application/pdf'), 'not_an_image'],
    [
      'a file too large to decode safely',
      file('image/png', SCREENSHOT_MAX_INPUT_BYTES + 1),
      'too_large_to_read',
    ],
  ] as const)('refuses %s before decoding it', async (_name, input, reason) => {
    const { codec, attempts } = fakeCodec({ width: 10, height: 10 }, () => ({
      type: 'image/webp',
      size: 10,
    }))

    expect(await prepareScreenshot(input, codec)).toEqual({ ok: false, reason })
    expect(attempts).toHaveLength(0)
  })

  it('refuses an image the browser cannot decode', async () => {
    const codec: ScreenshotCodec = {
      decode: async () => {
        throw new Error('broken file')
      },
      encode: async () => new Blob(),
      toBase64: async () => '',
    }

    expect(await prepareScreenshot(file(), codec)).toEqual({
      ok: false,
      reason: 'unreadable',
    })
  })
})
