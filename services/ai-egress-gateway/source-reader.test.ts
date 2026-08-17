import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  AI_REVIEW_ROUTE_MAX_BYTES,
  AI_TREND_ROUTE_MAX_BYTES,
} from '../../src/shared/ai-internal-transport-contract'
import { createSensitiveSourceLease } from './source-lease'
import { readGatewaySourceRequest } from './source-reader'

const sourceSchema = z
  .object({
    route: z.literal('review-analysis'),
    source: z
      .object({
        kind: z.literal('review'),
        text: z.string().nullable(),
        rating: z.number().int().min(1).max(5),
        languageCode: z.string().nullable(),
        reviewedAtEpochMillis: z.number().int().nonnegative().safe(),
      })
      .strict(),
  })
  .strict()
type SourceRequest = z.infer<typeof sourceSchema>

function requestFromBytes(
  chunks: Uint8Array[],
  headers: Readonly<Record<string, string>> = { 'content-type': 'application/json' },
): Request {
  return new Request('https://internal.invalid/v1/review-analysis', {
    method: 'POST',
    headers,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    }),
    duplex: 'half',
  } as RequestInit)
}

function requestWithCancellation(
  bytes: Uint8Array,
  headers: Readonly<Record<string, string>>,
  onCancel: () => void,
): Request {
  return new Request('https://internal.invalid/v1/review-analysis', {
    method: 'POST',
    headers,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes)
      },
      cancel() {
        onCancel()
        bytes.fill(0)
      },
    }),
    duplex: 'half',
  } as RequestInit)
}

function validBytes(): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      route: 'review-analysis',
      source: {
        kind: 'review',
        text: 'RAW_REVIEW_SENTINEL',
        rating: 5,
        languageCode: 'en-Latn',
        reviewedAtEpochMillis: 1_780_000_000_000,
      },
    }),
  )
}

describe('gateway sensitive source lease', () => {
  it('permits synchronous preparation then nulls parsed source fields and zeroes all owned chunks', async () => {
    const bytes = validBytes()
    const first = bytes.slice(0, 25)
    const second = bytes.slice(25)
    const lease = createSensitiveSourceLease<SourceRequest>()
    await readGatewaySourceRequest(
      requestFromBytes([first, second]),
      AI_REVIEW_ROUTE_MAX_BYTES,
      sourceSchema,
      lease,
    )
    let retainedSource: object | null = null
    expect(
      lease.read((request) => {
        retainedSource = request.source
        return request.source.text
      }),
    ).toBe('RAW_REVIEW_SENTINEL')

    expect(lease.inspect()).toEqual({
      disposed: true,
      hasSource: false,
      ownedChunkCount: 3,
      allOwnedChunksZeroed: true,
    })
    expect(retainedSource).toEqual({
      kind: null,
      text: null,
      rating: null,
      languageCode: null,
      reviewedAtEpochMillis: null,
    })
    expect(first.every((byte) => byte === 0)).toBe(true)
    expect(second.every((byte) => byte === 0)).toBe(true)
    expect(() => lease.read(() => null)).toThrow(/disposed/)
  })

  it('rejects asynchronous source consumers so source cannot escape the preparation closure', async () => {
    const lease = createSensitiveSourceLease<{ source: { text: string } }>()
    lease.attachSource({ source: { text: 'RAW_REVIEW_SENTINEL' } }, (root) => root.source)
    expect(() => lease.read(async () => 'forbidden')).toThrow(/synchronous/)
    expect(lease.inspect().disposed).toBe(true)
  })

  it('releases references and zeroes chunks when a synchronous consumer freezes the source root', () => {
    const chunk = new Uint8Array([1, 2, 3])
    const source = { source: { text: 'RAW_REVIEW_SENTINEL' } }
    const lease = createSensitiveSourceLease<typeof source>()
    lease.registerOwnedChunk(chunk)
    lease.attachSource(source, (root) => root.source)

    expect(
      lease.read((request) => {
        Object.freeze(request.source)
        return request.source.text
      }),
    ).toBe('RAW_REVIEW_SENTINEL')
    expect(lease.inspect()).toEqual({
      disposed: true,
      hasSource: false,
      ownedChunkCount: 1,
      allOwnedChunksZeroed: true,
    })
  })

  it('does not throw or skip chunk zeroing when a hostile source root rejects inspection', () => {
    const first = new Uint8Array([1, 2])
    const second = new Uint8Array([3, 4])
    const hostileRoot = new Proxy<Record<string, unknown>>(
      { text: 'RAW_REVIEW_SENTINEL' },
      {
        ownKeys() {
          throw new Error('hostile ownKeys')
        },
      },
    )
    const source = { source: hostileRoot }
    const lease = createSensitiveSourceLease<typeof source>()
    lease.registerOwnedChunk(first)
    lease.registerOwnedChunk(second)
    lease.attachSource(source, (root) => root.source)

    expect(() => lease.dispose()).not.toThrow()
    expect(lease.inspect()).toEqual({
      disposed: true,
      hasSource: false,
      ownedChunkCount: 2,
      allOwnedChunksZeroed: true,
    })
  })
})

describe('gateway streaming source reader', () => {
  it('rejects media type, content encoding, lying length, BOM, duplicate keys, trailing JSON, invalid UTF-8, unsafe numbers, and unknown fields', async () => {
    const bodies: Array<
      Readonly<{ bytes: Uint8Array; headers?: Readonly<Record<string, string>> }>
    > = [
      { bytes: validBytes(), headers: { 'content-type': 'text/plain' } },
      { bytes: validBytes(), headers: {} },
      {
        bytes: validBytes(),
        headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
      },
      {
        bytes: validBytes(),
        headers: { 'content-type': 'application/json', 'content-length': '1' },
      },
      {
        bytes: validBytes(),
        headers: {
          'content-type': 'application/json',
          'content-length': String(AI_REVIEW_ROUTE_MAX_BYTES + 1),
        },
      },
      { bytes: Uint8Array.of(0xef, 0xbb, 0xbf, 0x7b, 0x7d) },
      {
        bytes: new TextEncoder().encode(
          '{"route":"review-analysis","source":{"kind":"review","text":"a","text":"b","rating":5,"languageCode":null,"reviewedAtEpochMillis":1}}',
        ),
      },
      {
        bytes: new TextEncoder().encode(`${new TextDecoder().decode(validBytes())} null`),
      },
      { bytes: Uint8Array.of(0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d) },
      {
        bytes: new TextEncoder().encode(
          '{"route":"review-analysis","source":{"kind":"review","text":"a","rating":5,"languageCode":null,"reviewedAtEpochMillis":9007199254740992}}',
        ),
      },
      {
        bytes: new TextEncoder().encode(
          '{"route":"review-analysis","source":{"kind":"review","text":"a","rating":5,"languageCode":null,"reviewedAtEpochMillis":1,"descriptor":{}}}',
        ),
      },
    ]

    for (const input of bodies) {
      const lease = createSensitiveSourceLease<SourceRequest>()
      await expect(
        readGatewaySourceRequest(
          requestFromBytes(
            [input.bytes],
            input.headers ?? { 'content-type': 'application/json' },
          ),
          AI_REVIEW_ROUTE_MAX_BYTES,
          sourceSchema,
          lease,
        ),
      ).rejects.toThrow(/gateway source request is invalid/)
      expect(lease.inspect()).toMatchObject({
        disposed: true,
        hasSource: false,
        allOwnedChunksZeroed: true,
      })
    }
  })

  it('cancels unread bodies when headers or declared length reject before reader acquisition', async () => {
    const invalidHeaders: readonly Readonly<Record<string, string>>[] = [
      { 'content-type': 'text/plain' },
      {
        'content-type': 'application/json',
        'content-length': String(AI_REVIEW_ROUTE_MAX_BYTES + 1),
      },
    ]
    for (const headers of invalidHeaders) {
      const bytes = validBytes()
      let cancelled = 0
      const lease = createSensitiveSourceLease<SourceRequest>()
      await expect(
        readGatewaySourceRequest(
          requestWithCancellation(bytes, headers, () => {
            cancelled += 1
          }),
          AI_REVIEW_ROUTE_MAX_BYTES,
          sourceSchema,
          lease,
        ),
      ).rejects.toThrow(/gateway source request is invalid/)
      expect(cancelled).toBe(1)
      expect(bytes.every((byte) => byte === 0)).toBe(true)
      expect(lease.inspect().disposed).toBe(true)
    }
  })

  it('enforces review and trend decoded caps even when Content-Length is absent or false', async () => {
    for (const maxBytes of [AI_REVIEW_ROUTE_MAX_BYTES, AI_TREND_ROUTE_MAX_BYTES]) {
      const oversized = new Uint8Array(maxBytes + 1).fill(0x20)
      const chunks = [oversized.subarray(0, maxBytes), oversized.subarray(maxBytes)]
      const lease = createSensitiveSourceLease<SourceRequest>()
      await expect(
        readGatewaySourceRequest(requestFromBytes(chunks), maxBytes, sourceSchema, lease),
      ).rejects.toThrow(/gateway source request is invalid/)
      expect(chunks.every((chunk) => chunk.every((byte) => byte === 0))).toBe(true)
      expect(lease.inspect().disposed).toBe(true)
    }
  })
})
