// Portal context — the image policy: what an upload may be, and what it becomes.

import { describe, expect, it } from 'vitest'
import {
  PORTAL_IMAGE_LIMITS,
  PORTAL_IMAGE_OUTPUT_CONTENT_TYPE,
  PORTAL_IMAGE_PURPOSES,
  assessEncodedImage,
  assessUpload,
  isAnimatedImage,
  planReencode,
  portalImageRejection,
  sniffImageFormat,
  type ImageFacts,
} from './portal-image-policy'
import { isPortalError } from './errors'

const bytes = (...values: number[]) => Uint8Array.from(values)
const ascii = (text: string) => Uint8Array.from(Buffer.from(text, 'latin1'))
const concat = (...parts: Uint8Array[]) => Uint8Array.from(Buffer.concat(parts))

const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46)
const PNG_SIGNATURE = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
const webp = (chunkFourCc = 'VP8 ', flags = 0) =>
  concat(
    ascii('RIFF'),
    bytes(40, 0, 0, 0),
    ascii('WEBP'),
    ascii(chunkFourCc),
    bytes(10, 0, 0, 0),
    bytes(flags, 0, 0, 0),
  )

const reasonOf = (result: { isErr: () => boolean; error?: unknown }) => {
  expect(result.isErr()).toBe(true)
  const error = result.error
  expect(isPortalError(error)).toBe(true)
  if (!isPortalError(error)) throw new Error('not a portal error')
  expect(error.code).toBe('image_rejected')
  return error.context?.reason
}

const facts = (overrides: Partial<ImageFacts> = {}): ImageFacts => ({
  format: 'jpeg',
  width: 3000,
  height: 2000,
  pages: 1,
  orientation: null,
  hasAlpha: false,
  ...overrides,
})

describe('sniffImageFormat', () => {
  it('names JPEG, PNG and WebP by their leading bytes', () => {
    expect(sniffImageFormat(JPEG)).toBe('jpeg')
    expect(sniffImageFormat(concat(PNG_SIGNATURE, bytes(0, 0, 0, 13)))).toBe('png')
    expect(sniffImageFormat(webp())).toBe('webp')
  })

  it.each([
    ['SVG', ascii('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['GIF', ascii('GIF89a\x01\x00\x01\x00')],
    ['HTML', ascii('<!doctype html><script>alert(1)</script>')],
    ['PDF', ascii('%PDF-1.7')],
    ['HEIC', concat(bytes(0, 0, 0, 24), ascii('ftypheic'))],
    ['AVIF', concat(bytes(0, 0, 0, 24), ascii('ftypavif'))],
    ['BMP', ascii('BM\x00\x00\x00\x00')],
    ['a RIFF that is not WebP', concat(ascii('RIFF'), bytes(4, 0, 0, 0), ascii('WAVE'))],
    ['an empty body', bytes()],
    ['one byte', bytes(0xff)],
  ])('refuses %s', (_name, body) => {
    expect(sniffImageFormat(body)).toBeNull()
  })
})

describe('isAnimatedImage', () => {
  const chunk = (type: string, length = 0) =>
    concat(bytes(0, 0, 0, length), ascii(type), new Uint8Array(length), bytes(0, 0, 0, 0))

  it('sees an animated PNG by its animation control chunk before the image data', () => {
    const apng = concat(PNG_SIGNATURE, chunk('IHDR', 13), chunk('acTL', 8), chunk('IDAT'))
    expect(isAnimatedImage(apng, 'png')).toBe(true)
  })

  it('does not call a plain PNG animated, nor read past its image data', () => {
    const plain = concat(
      PNG_SIGNATURE,
      chunk('IHDR', 13),
      chunk('IDAT'),
      chunk('acTL', 8),
    )
    expect(isAnimatedImage(plain, 'png')).toBe(false)
  })

  it('sees an animated WebP by the animation flag of its extended header', () => {
    expect(isAnimatedImage(webp('VP8X', 0x02), 'webp')).toBe(true)
    expect(isAnimatedImage(webp('VP8X', 0x10), 'webp')).toBe(false)
    expect(isAnimatedImage(webp('VP8 '), 'webp')).toBe(false)
  })

  it('never calls a JPEG animated', () => {
    expect(isAnimatedImage(JPEG, 'jpeg')).toBe(false)
  })

  it('survives a truncated PNG without looping', () => {
    const truncated = concat(PNG_SIGNATURE, bytes(0xff, 0xff, 0xff, 0xff), ascii('IHDR'))
    expect(isAnimatedImage(truncated, 'png')).toBe(false)
  })
})

describe('assessUpload', () => {
  it('accepts a JPEG whose declared type agrees, naming its format', () => {
    const result = assessUpload({ declaredContentType: 'image/jpeg', bytes: JPEG })
    expect(result.isOk() && result.value).toBe('jpeg')
  })

  it('reads the declared type without parameters or case', () => {
    const result = assessUpload({
      declaredContentType: 'Image/JPEG; charset=binary',
      bytes: JPEG,
    })
    expect(result.isOk()).toBe(true)
  })

  it('refuses an empty body', () => {
    expect(
      reasonOf(assessUpload({ declaredContentType: 'image/jpeg', bytes: bytes() })),
    ).toBe('empty')
  })

  it('refuses a body over the upload cap, exactly at the byte after it', () => {
    const atCap = new Uint8Array(PORTAL_IMAGE_LIMITS.maxUploadBytes)
    atCap.set(JPEG)
    expect(assessUpload({ declaredContentType: 'image/jpeg', bytes: atCap }).isOk()).toBe(
      true,
    )
    const over = new Uint8Array(PORTAL_IMAGE_LIMITS.maxUploadBytes + 1)
    over.set(JPEG)
    expect(
      reasonOf(assessUpload({ declaredContentType: 'image/jpeg', bytes: over })),
    ).toBe('too_large')
  })

  it.each([
    'image/svg+xml',
    'image/gif',
    'image/heic',
    'application/pdf',
    'text/html',
    '',
  ])('refuses a declared type of %j', (declaredContentType) => {
    expect(reasonOf(assessUpload({ declaredContentType, bytes: JPEG }))).toBe(
      'unsupported_type',
    )
  })

  it('refuses bytes that are not an accepted image whatever the declared type says', () => {
    expect(
      reasonOf(
        assessUpload({
          declaredContentType: 'image/png',
          bytes: ascii('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
        }),
      ),
    ).toBe('unsupported_type')
  })

  it('refuses a declared type that disagrees with the bytes', () => {
    expect(
      reasonOf(assessUpload({ declaredContentType: 'image/png', bytes: JPEG })),
    ).toBe('type_mismatch')
  })

  it('refuses an animated image', () => {
    expect(
      reasonOf(
        assessUpload({ declaredContentType: 'image/webp', bytes: webp('VP8X', 2) }),
      ),
    ).toBe('animated')
  })
})

describe('planReencode', () => {
  it('shrinks a hero to its long-edge cap, keeping the aspect ratio', () => {
    const plan = planReencode('hero', facts({ width: 4800, height: 3200 }))
    expect(plan.isOk()).toBe(true)
    if (!plan.isOk()) return
    expect(plan.value).toMatchObject({
      width: PORTAL_IMAGE_LIMITS.purposes.hero.maxEdge,
      height: 1600,
    })
    expect(plan.value.contentType).toBe(PORTAL_IMAGE_OUTPUT_CONTENT_TYPE)
  })

  it('never enlarges an image that is already within the cap', () => {
    const plan = planReencode('hero', facts({ width: 1600, height: 1200 }))
    expect(plan.isOk() && [plan.value.width, plan.value.height]).toEqual([1600, 1200])
  })

  it('plans from the displayed orientation, not the stored one', () => {
    const plan = planReencode(
      'hero',
      facts({ width: 4800, height: 3200, orientation: 6 }),
    )
    expect(plan.isOk()).toBe(true)
    if (!plan.isOk()) return
    // Stored landscape, displayed portrait: the long edge is the height.
    expect(plan.value.height).toBe(PORTAL_IMAGE_LIMITS.purposes.hero.maxEdge)
    expect(plan.value.width).toBeLessThan(plan.value.height)
  })

  it('keeps alpha only for a logo or a tile image that has it', () => {
    const logo = planReencode(
      'logo',
      facts({ format: 'png', width: 600, height: 200, hasAlpha: true }),
    )
    expect(logo.isOk() && logo.value.keepAlpha).toBe(true)
    const hero = planReencode('hero', facts({ hasAlpha: true }))
    expect(hero.isOk() && hero.value.keepAlpha).toBe(false)
  })

  it('refuses more pixels than the decoder may be asked to hold', () => {
    const edge = Math.floor(Math.sqrt(PORTAL_IMAGE_LIMITS.maxInputPixels)) + 1
    expect(reasonOf(planReencode('hero', facts({ width: edge, height: edge })))).toBe(
      'too_many_pixels',
    )
  })

  it('refuses a dimension the snapshot cannot carry', () => {
    expect(reasonOf(planReencode('hero', facts({ width: 20_000, height: 1000 })))).toBe(
      'too_many_pixels',
    )
  })

  it('refuses a multi-frame image', () => {
    expect(reasonOf(planReencode('hero', facts({ pages: 3 })))).toBe('animated')
  })

  it('refuses a format the policy does not accept even if the decoder read it', () => {
    expect(reasonOf(planReencode('hero', facts({ format: 'gif' })))).toBe(
      'unsupported_type',
    )
    expect(reasonOf(planReencode('hero', facts({ format: 'svg' })))).toBe(
      'unsupported_type',
    )
  })

  it.each([
    ['hero', 800, 400],
    ['logo', 20, 20],
    ['link_image', 100, 100],
  ] as const)('refuses a %s that is too small', (purpose, width, height) => {
    expect(reasonOf(planReencode(purpose, facts({ width, height })))).toBe('too_small')
  })

  it('refuses a strip too thin to be a photograph', () => {
    expect(reasonOf(planReencode('hero', facts({ width: 6000, height: 700 })))).toBe(
      'extreme_aspect',
    )
  })

  it('refuses zero, negative and fractional sizes', () => {
    for (const [width, height] of [
      [0, 100],
      [100, -1],
      [10.5, 10],
      [Number.NaN, 10],
    ] as const) {
      expect(planReencode('hero', facts({ width, height })).isErr()).toBe(true)
    }
  })

  it('gives every purpose a rule', () => {
    for (const purpose of PORTAL_IMAGE_PURPOSES) {
      const rule = PORTAL_IMAGE_LIMITS.purposes[purpose]
      expect(rule.maxEdge).toBeLessThanOrEqual(16_384)
      expect(rule.minLongEdge).toBeLessThan(rule.maxEdge)
      expect(rule.maxOutputBytes).toBeGreaterThan(0)
    }
  })
})

describe('assessEncodedImage', () => {
  const webpBody = (size: number) => {
    const body = new Uint8Array(size)
    body.set(webp())
    return body
  }

  it('accepts an encoded WebP of the planned size', () => {
    const plan = planReencode('hero', facts())
    if (!plan.isOk()) throw new Error('plan refused')
    const result = assessEncodedImage('hero', plan.value, {
      bytes: webpBody(200_000),
      width: plan.value.width,
      height: plan.value.height,
    })
    expect(result.isOk()).toBe(true)
  })

  it('refuses output that is not WebP', () => {
    const plan = planReencode('hero', facts())
    if (!plan.isOk()) throw new Error('plan refused')
    expect(
      reasonOf(
        assessEncodedImage('hero', plan.value, {
          bytes: JPEG,
          width: plan.value.width,
          height: plan.value.height,
        }),
      ),
    ).toBe('undecodable')
  })

  it('refuses output of a different size than planned', () => {
    const plan = planReencode('hero', facts())
    if (!plan.isOk()) throw new Error('plan refused')
    expect(
      reasonOf(
        assessEncodedImage('hero', plan.value, {
          bytes: webpBody(1000),
          width: plan.value.width + 1,
          height: plan.value.height,
        }),
      ),
    ).toBe('undecodable')
  })

  it('refuses output over the purpose budget', () => {
    const plan = planReencode('logo', facts({ width: 600, height: 200 }))
    if (!plan.isOk()) throw new Error('plan refused')
    expect(
      reasonOf(
        assessEncodedImage('logo', plan.value, {
          bytes: webpBody(PORTAL_IMAGE_LIMITS.purposes.logo.maxOutputBytes + 1),
          width: plan.value.width,
          height: plan.value.height,
        }),
      ),
    ).toBe('output_too_large')
  })
})

describe('portalImageRejection', () => {
  it('builds the one error code every refusal uses, carrying only a reason', () => {
    const error = portalImageRejection('animated')
    expect(error).toMatchObject({
      _tag: 'PortalError',
      code: 'image_rejected',
      context: { reason: 'animated' },
    })
  })
})
