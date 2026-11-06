// Tests for the request guard: body-size limit + x-request-id.
//
// The plugin is the nitro v3 wiring of two request-boundary controls:
//   - 413 short-circuit via h3's config.onRequest (the nitro `request`
//     runtime hook cannot short-circuit — nitro routes hook errors into
//     captureError and lets the request through, so the guard installs ahead
//     of it; a typed HTTP error carries the content-free Response through
//     h3's error handling and response hooks).
//   - x-request-id on every response via the nitro `response` hook.

import { describe, it, expect, vi } from 'vitest'
import { HTTPError } from 'nitro/h3'
import {
  resolveRequestId,
  bodyLimitFor,
  bodyLimitRejection,
  createRequestGuardPlugin,
  type RequestGuardOptions,
  MAX_INBOUND_REQUEST_ID_LENGTH,
} from './request-guard'

describe('resolveRequestId', () => {
  const idGen = () => 'generated-uuid-like-id'

  it('honors a sane inbound request id', () => {
    expect(resolveRequestId('b7f1c2a4-1234-4f56-9abc-def012345678', idGen)).toBe(
      'b7f1c2a4-1234-4f56-9abc-def012345678',
    )
  })

  it('generates when the inbound id is absent', () => {
    expect(resolveRequestId(undefined, idGen)).toBe('generated-uuid-like-id')
    expect(resolveRequestId(null, idGen)).toBe('generated-uuid-like-id')
    expect(resolveRequestId('', idGen)).toBe('generated-uuid-like-id')
  })

  it('rejects inbound ids with header-unsafe characters', () => {
    expect(resolveRequestId('abc\r\nX-Injected: 1', idGen)).toBe('generated-uuid-like-id')
    expect(resolveRequestId('has space', idGen)).toBe('generated-uuid-like-id')
    expect(resolveRequestId('ünicode', idGen)).toBe('generated-uuid-like-id')
    expect(resolveRequestId('semi;colon', idGen)).toBe('generated-uuid-like-id')
  })

  it('bounds inbound id length', () => {
    const atMax = 'a'.repeat(MAX_INBOUND_REQUEST_ID_LENGTH)
    const overMax = 'a'.repeat(MAX_INBOUND_REQUEST_ID_LENGTH + 1)
    expect(resolveRequestId(atMax, idGen)).toBe(atMax)
    expect(resolveRequestId(overMax, idGen)).toBe('generated-uuid-like-id')
  })
})

describe('bodyLimitRejection', () => {
  it('allows requests without a content-length header', () => {
    expect(bodyLimitRejection(null, 1024)).toBeUndefined()
    expect(bodyLimitRejection(undefined, 1024)).toBeUndefined()
  })

  it('allows requests at or under the limit', () => {
    expect(bodyLimitRejection('1024', 1024)).toBeUndefined()
    expect(bodyLimitRejection('1', 1024)).toBeUndefined()
  })

  it('rejects with a content-free 413 when over the limit', async () => {
    const rejection = bodyLimitRejection('1025', 1024)
    expect(rejection).toBeInstanceOf(Response)
    expect(rejection!.status).toBe(413)
    expect(rejection!.headers.get('content-type')).toContain('application/json')
    const body = await rejection!.json()
    // No internals (limit value, stack, SQL) leak into the response body.
    expect(body).toEqual({ error: 'payload_too_large' })
  })

  it('treats an unparseable content-length as absent (HTTP parser backstops)', () => {
    expect(bodyLimitRejection('not-a-number', 1024)).toBeUndefined()
  })
})

describe('bodyLimitFor', () => {
  const overrides = [{ path: '/api/portal-media', limitBytes: 5000 }] as const

  it('uses the default for any path without an override', () => {
    expect(bodyLimitFor('/api/x', 100, overrides)).toBe(100)
    expect(bodyLimitFor('/', 100)).toBe(100)
  })

  it('uses the override for exactly its path', () => {
    expect(bodyLimitFor('/api/portal-media', 100, overrides)).toBe(5000)
  })

  it('does not widen the limit for a path that merely resembles the override', () => {
    for (const path of [
      '/api/portal-media/',
      '/api/portal-media/other',
      '/api/portal-media-x',
      '/api/portal-media/../x',
      '/API/PORTAL-MEDIA',
      '/x/api/portal-media',
    ]) {
      expect(bodyLimitFor(path, 100, overrides), path).toBe(100)
    }
  })

  it('never lets an override lower the limit below the default', () => {
    expect(bodyLimitFor('/a', 100, [{ path: '/a', limitBytes: 10 }])).toBe(100)
  })
})

describe('createRequestGuardPlugin', () => {
  type FakeEvent = { req: Request }
  function fakeNitroApp() {
    const hooks: Record<string, (...args: never[]) => void> = {}
    const h3 = { config: {} as { onRequest?: (event: FakeEvent) => unknown } }
    const app = {
      h3,
      hooks: {
        hook: (name: string, fn: (...args: never[]) => void) => {
          hooks[name] = fn
        },
      },
    }
    return { app, h3, hooks }
  }

  const postWithLength = (length: string): FakeEvent => ({
    req: new Request('http://localhost/api/x', {
      method: 'POST',
      headers: { 'content-length': length },
    }),
  })

  it('installs an onRequest wrapper that throws an HTTP 413 for oversized bodies', () => {
    const { app, h3 } = fakeNitroApp()
    createRequestGuardPlugin({ bodyLimitBytes: 100, idGen: () => 'gid' })(app as never)
    expect(h3.config.onRequest).toBeTypeOf('function')
    try {
      h3.config.onRequest!(postWithLength('101'))
      expect.unreachable('oversized bodies must not reach the handler chain')
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(HTTPError)
      expect((thrown as HTTPError).status).toBe(413)
    }
  })

  describe('a path with its own limit', () => {
    const guarded = () => {
      const { app, h3 } = fakeNitroApp()
      createRequestGuardPlugin({
        bodyLimitBytes: 100,
        pathBodyLimits: [{ path: '/api/portal-media', limitBytes: 1000 }],
        idGen: () => 'gid',
      })(app as never)
      return h3.config.onRequest!
    }
    const post = (path: string, length: string): FakeEvent => ({
      req: new Request(`http://localhost${path}?a=1`, {
        method: 'POST',
        headers: { 'content-length': length },
      }),
    })
    const status = (run: () => unknown) => {
      try {
        run()
        return 200
      } catch (thrown) {
        return (thrown as Response).status
      }
    }

    it('accepts a larger body there, and refuses one past the larger limit', () => {
      const onRequest = guarded()
      expect(status(() => onRequest(post('/api/portal-media', '1000')))).toBe(200)
      expect(status(() => onRequest(post('/api/portal-media', '1001')))).toBe(413)
    })

    it('keeps the default limit everywhere else, including beside that path', () => {
      const onRequest = guarded()
      expect(status(() => onRequest(post('/api/other', '101')))).toBe(413)
      expect(status(() => onRequest(post('/api/portal-media/x', '101')))).toBe(413)
      expect(status(() => onRequest(post('/api/other', '100')))).toBe(200)
    })
  })

  it('delegates to the previous onRequest for in-limit requests', () => {
    const { app, h3 } = fakeNitroApp()
    const previous = vi.fn()
    h3.config.onRequest = previous
    createRequestGuardPlugin({ bodyLimitBytes: 100, idGen: () => 'gid' })(app as never)
    const event = postWithLength('100')
    h3.config.onRequest!(event)
    expect(previous).toHaveBeenCalledWith(event)
  })

  describe('a body with no declared length', () => {
    // A chunked request carries no content-length, so the guard has to count.
    const chunkedPost = (chunks: readonly string[], path = '/api/x') => {
      const encoder = new TextEncoder()
      const pending = [...chunks]
      return new Request(`http://localhost${path}`, {
        method: 'POST',
        body: new ReadableStream<Uint8Array>({
          pull(controller) {
            const chunk = pending.shift()
            if (chunk === undefined) controller.close()
            else controller.enqueue(encoder.encode(chunk))
          },
        }),
        duplex: 'half',
      } as RequestInit)
    }
    const guardedBy = (options: RequestGuardOptions) => {
      const { app, h3 } = fakeNitroApp()
      const previous = vi.fn()
      h3.config.onRequest = previous
      createRequestGuardPlugin(options)(app as never)
      return { onRequest: h3.config.onRequest!, previous }
    }

    it('refuses a body that runs past the limit, counted in bytes, before its handler', async () => {
      const { onRequest, previous } = guardedBy({ bodyLimitBytes: 5 })

      // 'abc' and '€' are 3 and 3 bytes: 6 bytes in 4 characters.
      const refusal = await Promise.resolve(
        onRequest({ req: chunkedPost(['abc', '€']) }),
      ).then(
        () => undefined,
        (thrown: unknown) => thrown,
      )

      expect(refusal).toBeInstanceOf(HTTPError)
      expect((refusal as HTTPError).status).toBe(413)
      const response = (refusal as HTTPError & { response: Response }).response
      expect(response.status).toBe(413)
      await expect(response.json()).resolves.toEqual({
        error: 'payload_too_large',
      })
      expect(previous).not.toHaveBeenCalled()
    })

    it('hands a body at the limit to its handler with every byte and the same request', async () => {
      const { onRequest, previous } = guardedBy({ bodyLimitBytes: 6 })
      const request = chunkedPost(['abc', '€'])
      const event = { req: request }

      await onRequest(event)

      expect(previous).toHaveBeenCalledWith(event)
      expect(event.req).toBe(request)
      await expect(request.text()).resolves.toBe('abc€')
    })

    it('counts against the limit of the path, the default or its own', async () => {
      const { onRequest } = guardedBy({
        bodyLimitBytes: 3,
        pathBodyLimits: [{ path: '/api/portal-media', limitBytes: 6 }],
      })

      const atItsOwnLimit = chunkedPost(['abc', '€'], '/api/portal-media')
      await onRequest({ req: atItsOwnLimit })
      await expect(atItsOwnLimit.text()).resolves.toBe('abc€')
      await expect(
        onRequest({ req: chunkedPost(['abc', '€', '!'], '/api/portal-media') }),
      ).rejects.toMatchObject({ status: 413 })
      await expect(onRequest({ req: chunkedPost(['abc', '€']) })).rejects.toMatchObject({
        status: 413,
      })
    })

    it('cancels both branches and refuses without waiting for the source to cancel', async () => {
      const { onRequest } = guardedBy({ bodyLimitBytes: 5 })
      const cancel = vi.fn(() => new Promise<void>(() => {}))
      const request = new Request('http://localhost/api/x', {
        method: 'POST',
        body: new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(new Uint8Array(6))
          },
          cancel,
        }),
        duplex: 'half',
      } as RequestInit)

      await expect(onRequest({ req: request })).rejects.toMatchObject({ status: 413 })
      expect(cancel).toHaveBeenCalledOnce()
    })

    it('passes on a body whose stream fails: a client that left is not an oversized body', async () => {
      const { onRequest, previous } = guardedBy({ bodyLimitBytes: 5 })
      const request = new Request('http://localhost/api/x', {
        method: 'POST',
        body: new ReadableStream<Uint8Array>({
          pull() {
            throw new Error('the client went away')
          },
        }),
        duplex: 'half',
      } as RequestInit)
      const event = { req: request }

      await onRequest(event)

      expect(previous).toHaveBeenCalledWith(event)
    })
  })

  describe('a body that declares its length, or none at all', () => {
    const untouched = (request: Request) => {
      const { app, h3 } = fakeNitroApp()
      const previous = vi.fn()
      h3.config.onRequest = previous
      createRequestGuardPlugin({ bodyLimitBytes: 100 })(app as never)
      const clone = vi.spyOn(request, 'clone')
      const event = { req: request }
      const answer = h3.config.onRequest!(event)
      return { answer, previous, clone, event }
    }

    it('is left unread for its handler, which decides what to read and when', () => {
      const request = new Request('http://localhost/api/x', {
        method: 'POST',
        headers: { 'content-length': '4' },
        body: 'abcd',
      })

      const { answer, previous, clone, event } = untouched(request)

      expect(answer).toBeUndefined()
      expect(previous).toHaveBeenCalledWith(event)
      expect(clone).not.toHaveBeenCalled()
      expect(request.bodyUsed).toBe(false)
    })

    it('is not touched when the request has no body at all', () => {
      const { answer, previous, clone, event } = untouched(
        new Request('http://localhost/api/x'),
      )

      expect(answer).toBeUndefined()
      expect(previous).toHaveBeenCalledWith(event)
      expect(clone).not.toHaveBeenCalled()
    })
  })

  it('response hook echoes a sane inbound x-request-id', () => {
    const { app, hooks } = fakeNitroApp()
    createRequestGuardPlugin({ bodyLimitBytes: 100, idGen: () => 'gid' })(app as never)
    const res = new Response('ok')
    const event = {
      req: new Request('http://localhost/', {
        headers: { 'x-request-id': 'inbound-id-1' },
      }),
    }
    hooks['response']!(res as never, event as never)
    expect(res.headers.get('x-request-id')).toBe('inbound-id-1')
  })

  it('response hook generates an id when the inbound one is absent or unsafe', () => {
    const { app, hooks } = fakeNitroApp()
    createRequestGuardPlugin({ bodyLimitBytes: 100, idGen: () => 'gid' })(app as never)
    const res = new Response('ok')
    hooks['response']!(res as never, { req: new Request('http://localhost/') } as never)
    expect(res.headers.get('x-request-id')).toBe('gid')

    const res2 = new Response('ok')
    hooks['response']!(
      res2 as never,
      {
        req: new Request('http://localhost/', {
          headers: { 'x-request-id': 'bad id' },
        }),
      } as never,
    )
    expect(res2.headers.get('x-request-id')).toBe('gid')
  })
})
