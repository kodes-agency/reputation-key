// Portal context — the sharp image processor against hostile and ordinary bytes.
// Every fixture is generated here: no binary blobs are checked in.

import { deflateSync } from 'node:zlib'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { createSharpImageProcessor } from './sharp-image-processor.adapter'
import { isPortalError } from '../../domain/errors'
import {
  PORTAL_IMAGE_LIMITS,
  planReencode,
  sniffImageFormat,
  type ReencodePlan,
} from '../../domain/portal-image-policy'

const processor = createSharpImageProcessor()

const solid = (width: number, height: number, channels: 3 | 4 = 3) =>
  sharp({
    create: {
      width,
      height,
      channels,
      background: { r: 200, g: 40, b: 40, alpha: channels === 4 ? 0.5 : 1 },
    },
  })

const text = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1')

const planFor = async (bytes: Uint8Array, purpose: 'hero' | 'logo' = 'hero') => {
  const result = planReencode(purpose, await processor.inspect(bytes))
  if (!result.isOk())
    throw new Error(`planning refused: ${String(result.error.context?.reason)}`)
  return result.value
}

const rejectionReason = async (action: Promise<unknown>) => {
  try {
    await action
  } catch (error) {
    expect(isPortalError(error)).toBe(true)
    if (isPortalError(error)) {
      expect(error.code).toBe('image_rejected')
      return error.context?.reason
    }
  }
  throw new Error('expected a rejection')
}

describe('inspect', () => {
  it('reports the format, size, frames and orientation of a photograph', async () => {
    const jpeg = await solid(1600, 1000)
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer()
    expect(await processor.inspect(jpeg)).toEqual({
      format: 'jpeg',
      width: 1600,
      height: 1000,
      pages: 1,
      orientation: 6,
      hasAlpha: false,
    })
  })

  it('reports alpha on a PNG that has it', async () => {
    const png = await solid(300, 300, 4).png().toBuffer()
    expect(await processor.inspect(png)).toMatchObject({ format: 'png', hasAlpha: true })
  })

  it.each([
    [
      'an SVG',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9"/>'),
    ],
    ['plain text', Buffer.from('not an image at all')],
    ['nothing', Buffer.alloc(0)],
  ])('refuses %s without crashing', async (_name, bytes) => {
    expect(await rejectionReason(processor.inspect(bytes))).toMatch(
      /undecodable|unsupported_type/,
    )
  })

  it('refuses a GIF even though the decoder could read it', async () => {
    const gif = await solid(40, 40).gif().toBuffer()
    expect(await rejectionReason(processor.inspect(gif))).toMatch(
      /undecodable|unsupported_type/,
    )
  })

  it('refuses an animated WebP by its frame count', async () => {
    const frames = Buffer.concat([
      await solid(64, 32).raw().toBuffer(),
      await solid(64, 32).negate().raw().toBuffer(),
    ])
    const animated = await sharp(frames, {
      raw: { width: 64, height: 64, channels: 3, pageHeight: 32 },
    })
      .webp()
      .toBuffer()
    const facts = await processor.inspect(animated)
    expect(facts.pages).toBeGreaterThan(1)
    expect(planReencode('hero', facts).isErr()).toBe(true)
  })
})

describe('reencode', () => {
  it('produces a WebP of exactly the planned size', async () => {
    const jpeg = await solid(4000, 2500).jpeg().toBuffer()
    const plan = await planFor(jpeg)
    const encoded = await processor.reencode(jpeg, plan)
    expect(sniffImageFormat(encoded.bytes)).toBe('webp')
    const meta = await sharp(encoded.bytes).metadata()
    expect([meta.width, meta.height]).toEqual([plan.width, plan.height])
    expect([encoded.width, encoded.height]).toEqual([plan.width, plan.height])
    expect(plan.width).toBe(PORTAL_IMAGE_LIMITS.purposes.hero.maxEdge)
  })

  it('strips EXIF (including GPS), XMP and the colour profile', async () => {
    const marker = 'SECRET-GPS-MARKER-5551234'
    const jpeg = await solid(1600, 1000)
      .jpeg()
      .withExif({ IFD0: { Copyright: marker, Artist: 'Someone Private' } })
      .withIccProfile('p3')
      .toBuffer()
    expect(text(jpeg)).toContain(marker)
    const encoded = await processor.reencode(jpeg, await planFor(jpeg))
    const meta = await sharp(encoded.bytes).metadata()
    expect(meta.exif).toBeUndefined()
    expect(meta.xmp).toBeUndefined()
    expect(meta.icc).toBeUndefined()
    expect(text(encoded.bytes)).not.toContain(marker)
    expect(text(encoded.bytes)).not.toContain('Someone Private')
  })

  it('applies the EXIF orientation before the metadata is dropped', async () => {
    // Stored 1600x1000 with the left half red and the right half blue, tagged
    // orientation 6 (turn a quarter clockwise): displayed 1000x1600, red on top.
    const blueRight = await solid(800, 1000).negate().png().toBuffer()
    const jpeg = await solid(1600, 1000)
      .composite([{ input: blueRight, left: 800, top: 0 }])
      .jpeg({ quality: 95 })
      .withMetadata({ orientation: 6 })
      .toBuffer()
    const plan = await planFor(jpeg)
    expect([plan.width, plan.height]).toEqual([1000, 1600])
    const encoded = await processor.reencode(jpeg, plan)
    const meta = await sharp(encoded.bytes).metadata()
    expect([meta.width, meta.height, meta.orientation]).toEqual([1000, 1600, undefined])
    const pixelAt = async (top: number) =>
      sharp(encoded.bytes)
        .extract({ left: 500, top, width: 1, height: 1 })
        .raw()
        .toBuffer()
    const [topRed = 0, , topBlue = 0] = await pixelAt(200)
    const [bottomRed = 0, , bottomBlue = 0] = await pixelAt(1400)
    expect(topRed).toBeGreaterThan(topBlue)
    expect(bottomBlue).toBeGreaterThan(bottomRed)
  })

  it('discards data hidden after the image: a polyglot comes out as a plain picture', async () => {
    const jpeg = await solid(1600, 1000).jpeg().toBuffer()
    const payload = '<script>alert(document.cookie)</script><?php system($_GET["c"]); ?>'
    const polyglot = Buffer.concat([jpeg, Buffer.from(payload)])
    const encoded = await processor.reencode(polyglot, await planFor(polyglot))
    expect(text(encoded.bytes)).not.toContain('<script>')
    expect(text(encoded.bytes)).not.toContain('<?php')
    expect(sniffImageFormat(encoded.bytes)).toBe('webp')
  })

  it('discards comment segments a JPEG carries', async () => {
    const jpeg = await solid(1600, 1000).jpeg().toBuffer()
    const comment = Buffer.from('<img src=x onerror=alert(1)>')
    const segment = Buffer.concat([
      Buffer.from([0xff, 0xfe, (comment.length + 2) >> 8, (comment.length + 2) & 0xff]),
      comment,
    ])
    const withComment = Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)])
    expect(text(withComment)).toContain('onerror')
    const encoded = await processor.reencode(withComment, await planFor(withComment))
    expect(text(encoded.bytes)).not.toContain('onerror')
  })

  it('flattens transparency for a purpose that does not keep it', async () => {
    const png = await solid(1600, 1000, 4).png().toBuffer()
    const plan = await planFor(png)
    expect(plan.keepAlpha).toBe(false)
    const encoded = await processor.reencode(png, plan)
    expect((await sharp(encoded.bytes).metadata()).hasAlpha).toBe(false)
  })

  it('keeps transparency for a logo', async () => {
    const png = await solid(600, 200, 4).png().toBuffer()
    const plan = await planFor(png, 'logo')
    expect(plan.keepAlpha).toBe(true)
    const encoded = await processor.reencode(png, plan)
    expect((await sharp(encoded.bytes).metadata()).hasAlpha).toBe(true)
  })

  it('refuses a truncated JPEG', async () => {
    const jpeg = await solid(1600, 1000).jpeg().toBuffer()
    const truncated = jpeg.subarray(0, Math.floor(jpeg.length / 2))
    const plan = await planFor(jpeg)
    expect(await rejectionReason(processor.reencode(truncated, plan))).toBe('undecodable')
  })

  it('refuses garbage that carries a JPEG signature', async () => {
    const forged = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.alloc(2000, 7),
    ])
    const plan: ReencodePlan = {
      width: 1600,
      height: 1000,
      quality: 80,
      keepAlpha: false,
      contentType: 'image/webp',
    }
    expect(await rejectionReason(processor.reencode(forged, plan))).toBe('undecodable')
  })

  it('refuses a decompression bomb: a tiny PNG that claims a huge canvas', async () => {
    const bomb = pngClaiming(50_000, 50_000)
    expect(bomb.length).toBeLessThan(1000)
    const facts = await processor.inspect(bomb).catch(() => null)
    // Either the header is refused outright or the policy refuses its size.
    if (facts) expect(planReencode('hero', facts).isErr()).toBe(true)
    const plan: ReencodePlan = {
      width: 2400,
      height: 2400,
      quality: 80,
      keepAlpha: false,
      contentType: 'image/webp',
    }
    expect(await rejectionReason(processor.reencode(bomb, plan))).toMatch(
      /too_many_pixels|undecodable/,
    )
  })

  it('does not let one failure stop the next upload', async () => {
    await processor.reencode(Buffer.from('nope'), planAny()).catch(() => undefined)
    const jpeg = await solid(1600, 1000).jpeg().toBuffer()
    const encoded = await processor.reencode(jpeg, await planFor(jpeg))
    expect(sniffImageFormat(encoded.bytes)).toBe('webp')
  })

  it('answers every upload when several arrive at once (the budget itself is pinned in the gate test)', async () => {
    const jpeg = await solid(1600, 1000).jpeg().toBuffer()
    const plan = await planFor(jpeg)
    const results = await Promise.all(
      Array.from({ length: 6 }, () => processor.reencode(jpeg, plan)),
    )
    expect(results).toHaveLength(6)
  })
})

function planAny(): ReencodePlan {
  return {
    width: 100,
    height: 100,
    quality: 80,
    keepAlpha: false,
    contentType: 'image/webp',
  }
}

/** A well-formed PNG whose header claims a canvas its data does not fill. */
function pngClaiming(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (data: Buffer) => {
    let c = 0xffffffff
    for (const byte of data) c = (crcTable[(c ^ byte) & 0xff] as number) ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const checksum = Buffer.alloc(4)
    checksum.writeUInt32BE(crc(body))
    return Buffer.concat([length, body, checksum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc(64))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
