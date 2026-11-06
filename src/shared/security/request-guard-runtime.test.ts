import { describe, expect, it, vi } from 'vitest'
import { H3Core, type H3Event } from 'nitro/h3'
import type { NitroAppPlugin } from 'nitro/types'
import { createRequestGuardPlugin } from './request-guard'
import { securityHeadersPlugin } from './security-headers'

const requestId = 'request-boundary-test'
type BodyMode = 'declared' | 'undeclared' | 'chunked'

function request(body: string, mode: BodyMode, path = '/submit') {
  const bytes = new TextEncoder().encode(body)
  const headers = new Headers()
  if (mode === 'declared') headers.set('content-length', String(bytes.length))
  if (mode === 'chunked') headers.set('transfer-encoding', 'chunked')
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
      controller.close()
    },
  })
  return Object.assign(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers,
      body: stream,
      // Node's streaming Request requires duplex; the Request retains adapter metadata.
      ...{ duplex: 'half' },
    }),
    { context: { adapterMarker: Symbol('adapter-metadata') } },
  )
}

async function runtime(
  options: {
    pathBodyLimits?: { path: string; limitBytes: number }[]
    routeError?: Error
  } = {},
) {
  const hook = vi.fn()
  const captureError = vi.fn()
  const previousOnRequest = vi.fn((event: H3Event) => {
    event.res.headers.set('x-previous-request', 'called')
  })
  const previousOnError = vi.fn((error: unknown) => {
    captureError(error)
    if (options.routeError) return new Response('existing error handler', { status: 502 })
  })
  const h3 = new H3Core({
    silent: true,
    onRequest: previousOnRequest,
    onError: previousOnError,
    async onResponse(response, event) {
      for (const [name, callback] of hook.mock.calls) {
        if (name === 'response') await callback(response, event)
      }
    },
  })
  const route = vi.fn(async (event: H3Event) => {
    if (options.routeError) throw options.routeError
    return new Response(await event.req.text())
  })
  h3['~middleware'].push(route)
  const app: Parameters<NitroAppPlugin>[0] = {
    h3,
    fetch: (req) => h3.fetch(req),
    captureError,
    hooks: { hook, removeHook: vi.fn(), callHook: vi.fn() },
  }
  await securityHeadersPlugin(app)
  await createRequestGuardPlugin({
    bodyLimitBytes: 8,
    pathBodyLimits: options.pathBodyLimits,
    idGen: () => requestId,
  })(app)
  return { app, route, previousOnRequest, previousOnError, captureError }
}

function expectBoundaryHeaders(response: Response) {
  expect(response.headers.get('x-request-id')).toBe(requestId)
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  expect(response.headers.get('x-frame-options')).toBe('DENY')
  expect(response.headers.get('content-security-policy')).toContain("default-src 'none'")
}

describe('request guard through the Nitro H3 lifecycle', () => {
  it.each<BodyMode>(['declared', 'undeclared', 'chunked'])(
    'returns a final 413 for an oversized %s body without invoking application hooks',
    async (mode) => {
      const { app, route, previousOnRequest, previousOnError, captureError } =
        await runtime()

      const response = await app.fetch(request('ééééa', mode))

      expect(response.status).toBe(413)
      expect(await response.json()).toEqual({ error: 'payload_too_large' })
      expectBoundaryHeaders(response)
      expect(route).not.toHaveBeenCalled()
      expect(previousOnRequest).not.toHaveBeenCalled()
      expect(previousOnError).not.toHaveBeenCalled()
      expect(captureError).not.toHaveBeenCalled()
    },
  )

  it.each([
    { body: 'ééé', mode: 'declared' },
    { body: 'éééé', mode: 'declared' },
    { body: 'ééé', mode: 'undeclared' },
    { body: 'éééé', mode: 'chunked' },
  ] satisfies { body: string; mode: BodyMode }[])(
    'preserves $mode body bytes and request metadata at or below the limit: $body',
    async ({ body, mode }) => {
      const { app, route, previousOnRequest, previousOnError, captureError } =
        await runtime()
      const req = request(body, mode)

      const response = await app.fetch(req)

      expect(response.status).toBe(200)
      expect(await response.text()).toBe(body)
      expectBoundaryHeaders(response)
      expect(response.headers.get('x-previous-request')).toBe('called')
      expect(previousOnRequest).toHaveBeenCalledOnce()
      expect(route).toHaveBeenCalledOnce()
      expect(route.mock.calls[0]?.[0].req).toBe(req)
      expect(req.context.adapterMarker).toBeDefined()
      expect(previousOnError).not.toHaveBeenCalled()
      expect(captureError).not.toHaveBeenCalled()
    },
  )

  it.each([
    { path: '/larger?mode=upload', status: 200 },
    { path: '/larger/child', status: 413 },
    { path: '/larger-extra', status: 413 },
  ])(
    'applies the larger limit only to the exact endpoint: $path',
    async ({ path, status }) => {
      const { app, route } = await runtime({
        pathBodyLimits: [{ path: '/larger', limitBytes: 12 }],
      })

      const response = await app.fetch(request('éééééé', 'chunked', path))

      expect(response.status).toBe(status)
      expectBoundaryHeaders(response)
      if (status === 200) {
        expect(await response.text()).toBe('éééééé')
        expect(route).toHaveBeenCalledOnce()
      } else {
        expect(await response.json()).toEqual({ error: 'payload_too_large' })
        expect(route).not.toHaveBeenCalled()
      }
    },
  )

  it('delegates unrelated failures to the existing error handler', async () => {
    const { app, previousOnError, captureError } = await runtime({
      routeError: new Error('route failed'),
    })

    const response = await app.fetch(request('ok', 'declared'))

    expect(response.status).toBe(502)
    expect(await response.text()).toBe('existing error handler')
    expect(previousOnError).toHaveBeenCalledOnce()
    expect(captureError).toHaveBeenCalledOnce()
  })
})
