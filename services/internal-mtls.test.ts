import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { request as httpsRequest } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import type { ServerResponse } from 'node:http'
import type { DetailedPeerCertificate } from 'node:tls'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createBoundedInternalMtlsRequestSignal,
  createExactSpiffePeerIdentityResolver,
  createInternalMtlsJsonTransport,
  createInternalMtlsWebServer,
  parseInternalMtlsJsonResponse,
  loadInternalMtlsMaterialFromBase64,
  writeWebResponse,
} from './internal-mtls'

function certificate(input: Readonly<{ altNames: string; usages: string[] }>) {
  return {
    subjectaltname: input.altNames,
    ext_key_usage: input.usages,
    subject: { CN: 'must-not-be-authority' },
  } as unknown as DetailedPeerCertificate
}

describe('internal mTLS base64 material lifetime', () => {
  it('zeroes accepted CA and certificate buffers when late key decoding fails', () => {
    const fill = vi.spyOn(Buffer.prototype, 'fill')
    try {
      expect(() =>
        loadInternalMtlsMaterialFromBase64({
          ca: Buffer.from('ca').toString('base64'),
          cert: Buffer.from('cert').toString('base64'),
          key: 'not canonical base64!',
        }),
      ).toThrow('internal mTLS material is invalid')
      expect(
        fill.mock.instances
          .filter(Buffer.isBuffer)
          .filter((value) => value.byteLength === 2 || value.byteLength === 4)
          .every((value) => value.every((byte) => byte === 0)),
      ).toBe(true)
    } finally {
      fill.mockRestore()
    }
  })
  it('zeroes a decoded buffer when canonical base64 validation rejects it', () => {
    const fill = vi.spyOn(Buffer.prototype, 'fill')
    try {
      expect(() =>
        loadInternalMtlsMaterialFromBase64({
          ca: 'YQ=',
          cert: Buffer.from('cert').toString('base64'),
          key: Buffer.from('key').toString('base64'),
        }),
      ).toThrow('internal mTLS material is invalid')
      expect(
        fill.mock.instances
          .filter(Buffer.isBuffer)
          .some((value) => value.byteLength === 1 && value.every((byte) => byte === 0)),
      ).toBe(true)
    } finally {
      fill.mockRestore()
    }
  })
})

describe('internal mTLS response byte lifetime', () => {
  class DeferredResponse extends EventEmitter {
    statusCode = 0
    readonly headers = new Map<string, string | number | readonly string[]>()
    pendingCallback: ((error?: Error | null) => void) | null = null
    ended = false

    setHeader(name: string, value: string | number | readonly string[]) {
      this.headers.set(name, value)
    }

    write(_chunk: Uint8Array, callback: (error?: Error | null) => void): boolean {
      this.pendingCallback = callback
      return false
    }

    end(): void {
      this.ended = true
    }
  }

  it('keeps one owned view through backpressure and zeroes it after the socket callback', async () => {
    const chunk = Uint8Array.from([11, 22, 33])
    const sink = new DeferredResponse()
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(chunk)
          controller.close()
        },
      }),
    )
    const writing = writeWebResponse(sink as unknown as ServerResponse, response)
    await vi.waitFor(() => expect(sink.pendingCallback).not.toBeNull())
    expect(chunk).toEqual(Uint8Array.from([11, 22, 33]))
    sink.pendingCallback?.()
    await writing
    expect(chunk).toEqual(Uint8Array.from([0, 0, 0]))
    expect(sink.ended).toBe(true)
  })

  it('zeroes the active chunk and cancels queued response bytes on a mid-stream reset', async () => {
    const active = Uint8Array.from([1, 2, 3])
    const queued = Uint8Array.from([4, 5, 6])
    let cancelled = false
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(active)
          controller.enqueue(queued)
        },
        cancel() {
          cancelled = true
          queued.fill(0)
        },
      }),
    )
    const sink = new DeferredResponse()
    const writing = writeWebResponse(sink as unknown as ServerResponse, response)
    await vi.waitFor(() => expect(sink.pendingCallback).not.toBeNull())
    sink.emit('error', new Error('socket reset'))
    await expect(writing).rejects.toThrow('socket reset')
    expect(active).toEqual(Uint8Array.from([0, 0, 0]))
    expect(queued).toEqual(Uint8Array.from([0, 0, 0]))
    expect(cancelled).toBe(true)
  })
})

describe('exact SPIFFE peer identity resolver', () => {
  it('accepts an exact client-only URI SAN and clientAuth EKU for web/worker certificates', () => {
    const resolver = createExactSpiffePeerIdentityResolver({
      uri: 'spiffe://repkey.internal/repkey-worker',
      dnsName: null,
      extendedKeyUsages: ['clientAuth'],
    })
    expect(
      resolver(
        certificate({
          altNames: 'URI:spiffe://repkey.internal/repkey-worker',
          usages: ['1.3.6.1.5.5.7.3.2'],
        }),
      ),
    ).toBe('spiffe://repkey.internal/repkey-worker')
  })

  it('rejects extra SANs, wrong URI, missing/wrong/extra EKUs, and CN fallback', () => {
    const resolver = createExactSpiffePeerIdentityResolver({
      uri: 'spiffe://repkey.internal/repkey-web',
      dnsName: null,
      extendedKeyUsages: ['clientAuth'],
    })
    for (const candidate of [
      certificate({
        altNames: 'URI:spiffe://repkey.internal/repkey-web, DNS:repkey-web',
        usages: ['1.3.6.1.5.5.7.3.2'],
      }),
      certificate({
        altNames: 'URI:spiffe://repkey.internal/repkey-worker',
        usages: ['1.3.6.1.5.5.7.3.2'],
      }),
      certificate({
        altNames: 'URI:spiffe://repkey.internal/repkey-web',
        usages: [],
      }),
      certificate({
        altNames: 'URI:spiffe://repkey.internal/repkey-web',
        usages: ['1.3.6.1.5.5.7.3.1'],
      }),
      certificate({
        altNames: 'URI:spiffe://repkey.internal/repkey-web',
        usages: ['1.3.6.1.5.5.7.3.2', '1.3.6.1.5.5.7.3.1'],
      }),
      certificate({ altNames: '', usages: ['1.3.6.1.5.5.7.3.2'] }),
    ]) {
      expect(resolver(candidate)).toBeNull()
    }
  })

  it('preserves exact DNS+URI dual-EKU validation for gateway certificates', () => {
    const resolver = createExactSpiffePeerIdentityResolver({
      uri: 'spiffe://repkey.internal/ai-egress-gateway',
      dnsName: 'ai-egress-gateway',
      extendedKeyUsages: ['clientAuth', 'serverAuth'],
    })
    expect(
      resolver(
        certificate({
          altNames:
            'DNS:ai-egress-gateway, URI:spiffe://repkey.internal/ai-egress-gateway',
          usages: ['1.3.6.1.5.5.7.3.1', '1.3.6.1.5.5.7.3.2'],
        }),
      ),
    ).toBe('spiffe://repkey.internal/ai-egress-gateway')
  })
})

describe('internal mTLS request lifetime', () => {
  it('aborts the Web Request on caller disconnect but not after a normal response', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'repkey-internal-mtls-'))
    const keyPath = join(directory, 'test.key')
    const certPath = join(directory, 'test.crt')
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost',
        '-addext',
        'basicConstraints=critical,CA:TRUE',
        '-addext',
        'keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign',
        '-addext',
        'extendedKeyUsage=serverAuth,clientAuth',
      ],
      { stdio: 'ignore' },
    )
    const cert = readFileSync(certPath)
    const key = readFileSync(keyPath)
    const tls = Object.freeze({ ca: cert, cert, key })
    let startAbortHandler!: () => void
    const abortHandlerStarted = new Promise<void>((resolve) => {
      startAbortHandler = resolve
    })
    let observeAbort!: () => void
    const requestAborted = new Promise<void>((resolve) => {
      observeAbort = resolve
    })
    const normalSignals: AbortSignal[] = []
    const rejectedBodyCancels: ReturnType<typeof vi.spyOn>[] = []
    const server = createInternalMtlsWebServer({
      host: '127.0.0.1',
      port: 1,
      tls,
      maxRequestBytes: 1024,
      streamRequestBody: true,
      async handle(request) {
        const path = new URL(request.url).pathname
        if (path === '/abort') {
          startAbortHandler()
          if (request.signal.aborted) observeAbort()
          else request.signal.addEventListener('abort', observeAbort, { once: true })
          await requestAborted
          return Response.json({ ok: false })
        }
        if (path === '/reject') {
          if (request.body === null) throw new Error('expected request body')
          rejectedBodyCancels.push(vi.spyOn(request.body, 'cancel'))
          return Response.json({ ok: false }, { status: 405 })
        }
        normalSignals.push(request.signal)
        return Response.json({ ok: true })
      },
    })

    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      const address = server.address()
      if (address === null || typeof address === 'string')
        throw new Error('test server unavailable')
      const clientOptions = {
        hostname: '127.0.0.1',
        port: address.port,
        servername: 'localhost',
        ca: cert,
        cert,
        key,
        rejectUnauthorized: true,
      } as const

      const abandoned = httpsRequest({
        ...clientOptions,
        method: 'POST',
        path: '/abort',
        headers: { 'content-type': 'application/json', 'content-length': '2' },
      })
      abandoned.on('error', () => undefined)
      abandoned.end('{}')
      await abortHandlerStarted
      abandoned.destroy()
      await requestAborted

      await new Promise<void>((resolve, reject) => {
        const normal = httpsRequest(
          { ...clientOptions, method: 'GET', path: '/normal' },
          (response) => {
            response.resume()
            response.once('end', resolve)
          },
        )
        normal.once('error', reject)
        normal.end()
      })

      await new Promise<void>((resolve, reject) => {
        const rejected = httpsRequest(
          {
            ...clientOptions,
            method: 'POST',
            path: '/reject',
            headers: { 'content-type': 'application/json', 'content-length': '64' },
          },
          (response) => {
            response.resume()
            response.once('end', resolve)
          },
        )
        rejected.once('error', reject)
        rejected.end('x'.repeat(64))
      })
      expect(rejectedBodyCancels[0]).toBeDefined()
      expect(rejectedBodyCancels[0]).toHaveBeenCalledOnce()
      expect(normalSignals[0]?.aborted).toBe(false)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('internal mTLS strict JSON response boundary', () => {
  const response = (
    raw: string,
    options: Readonly<{
      status?: number
      contentType?: string
      contentEncoding?: string
    }> = {},
  ) => {
    const headers = new Headers()
    headers.set('content-type', options.contentType ?? 'application/json; charset=utf-8')
    if (options.contentEncoding !== undefined) {
      headers.set('content-encoding', options.contentEncoding)
    }
    return {
      status: options.status ?? 200,
      headers,
      body: Buffer.from(raw),
    }
  }

  it.each([
    ['non-200', response('{"ok":true}', { status: 503 })],
    ['wrong media type', response('{"ok":true}', { contentType: 'text/plain' })],
    ['encoded response', response('{"ok":true}', { contentEncoding: 'gzip' })],
    ['duplicate keys', response('{"ok":true,"ok":false}')],
    ['unsafe integer', response('{"value":9007199254740992}')],
  ])('rejects %s and zeroes the owned response bytes', (_label, candidate) => {
    expect(() => parseInternalMtlsJsonResponse(candidate, 65_536)).toThrow(
      'internal mTLS response is invalid',
    )
    expect(candidate.body.every((byte) => byte === 0)).toBe(true)
  })

  it('accepts the gateway 115-second outer transport bound and rejects a wider one', () => {
    const tls = {
      ca: Buffer.from('ca'),
      cert: Buffer.from('cert'),
      key: Buffer.from('key'),
    }
    const transport = createInternalMtlsJsonTransport({
      origin: 'https://ai-execution-admission.internal:8443',
      serverName: 'ai-execution-admission',
      tls,
      peerIdentityPolicy: {
        uri: 'spiffe://repkey.internal/ai-execution-admission',
        dnsName: 'ai-execution-admission',
        extendedKeyUsages: ['serverAuth'],
      },
      timeoutMs: 115_000,
    })
    transport.close()
    expect(() =>
      createInternalMtlsJsonTransport({
        origin: 'https://ai-execution-admission.internal:8443',
        serverName: 'ai-execution-admission',
        tls,
        peerIdentityPolicy: {
          uri: 'spiffe://repkey.internal/ai-execution-admission',
          dnsName: 'ai-execution-admission',
          extendedKeyUsages: ['serverAuth'],
        },
        timeoutMs: 115_001,
      }),
    ).toThrow('internal mTLS client configuration is invalid')
  })

  it('accepts an exact dual-use gateway certificate policy and rejects client-only peers', () => {
    const tls = {
      ca: Buffer.from('ca'),
      cert: Buffer.from('cert'),
      key: Buffer.from('key'),
    }
    const base = {
      origin: 'https://google-egress-gateway.internal:8443',
      serverName: 'google-egress-gateway',
      tls,
      peerIdentityPolicy: {
        uri: 'spiffe://repkey.internal/google-egress-gateway',
        dnsName: 'google-egress-gateway',
        extendedKeyUsages: ['serverAuth', 'clientAuth'],
      },
    } as const
    const transport = createInternalMtlsJsonTransport(base)
    transport.close()

    expect(() =>
      createInternalMtlsJsonTransport({
        ...base,
        peerIdentityPolicy: {
          ...base.peerIdentityPolicy,
          extendedKeyUsages: ['clientAuth'],
        },
      }),
    ).toThrow('internal mTLS client configuration is invalid')
  })
})

describe('internal mTLS outbound request byte lifetime', () => {
  const tls = {
    ca: Buffer.from('ca'),
    cert: Buffer.from('cert'),
    key: Buffer.from('key'),
  }
  const base = {
    origin: 'https://ai-execution-admission.internal:8443',
    serverName: 'ai-execution-admission',
    tls,
    peerIdentityPolicy: {
      uri: 'spiffe://repkey.internal/ai-execution-admission',
      dnsName: 'ai-execution-admission',
      extendedKeyUsages: ['serverAuth'],
    },
  } as const

  async function expectOwnedCopyCleared(
    transport: ReturnType<typeof createInternalMtlsJsonTransport>,
    options?: Readonly<{ deadlineEpochMillis?: number }>,
  ) {
    const source = Uint8Array.from({ length: 37 }, (_, index) => index + 1)
    const fill = vi.spyOn(Buffer.prototype, 'fill')
    try {
      await expect(
        transport.postBytesRaw('/v1/authorize', source, options),
      ).rejects.toThrow()
      expect(source.some((byte) => byte !== 0)).toBe(true)
      expect(
        fill.mock.instances
          .filter(Buffer.isBuffer)
          .some(
            (candidate) =>
              candidate.byteLength === source.byteLength &&
              candidate.every((byte) => byte === 0),
          ),
      ).toBe(true)
    } finally {
      fill.mockRestore()
      transport.close()
    }
  }

  it('clears encoded bytes when the bounded-signal factory throws synchronously', async () => {
    await expectOwnedCopyCleared(
      createInternalMtlsJsonTransport({
        ...base,
        requestSignalFactory: () => {
          throw new Error('signal setup failed')
        },
      }),
    )
  })

  it('clears encoded bytes when request construction throws synchronously', async () => {
    await expectOwnedCopyCleared(
      createInternalMtlsJsonTransport({
        ...base,
        requestFactory: (() => {
          throw new Error('request setup failed')
        }) as typeof httpsRequest,
      }),
    )
  })

  it('clears encoded bytes when a deadline expires between validation and signal setup', async () => {
    const transport = createInternalMtlsJsonTransport(base)
    const now = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_002)
    try {
      await expectOwnedCopyCleared(transport, { deadlineEpochMillis: 1_001 })
    } finally {
      now.mockRestore()
    }
  })
})

describe('internal mTLS client request deadline', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses the earlier configured timeout when the caller deadline is farther away', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const bounded = createBoundedInternalMtlsRequestSignal({
      timeoutMs: 5_000,
      deadlineEpochMillis: 106_000,
      nowEpochMillis: Date.now(),
    })

    await vi.advanceTimersByTimeAsync(4_999)
    expect(bounded.signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(bounded.signal.aborted).toBe(true)
    bounded.dispose()
  })

  it('uses an earlier caller deadline and propagates a caller abort', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const caller = new AbortController()
    const bounded = createBoundedInternalMtlsRequestSignal({
      timeoutMs: 105_000,
      deadlineEpochMillis: 3_000,
      nowEpochMillis: Date.now(),
      signal: caller.signal,
    })

    await vi.advanceTimersByTimeAsync(1_999)
    expect(bounded.signal.aborted).toBe(false)
    caller.abort()
    expect(bounded.signal.aborted).toBe(true)
    bounded.dispose()
  })
})
