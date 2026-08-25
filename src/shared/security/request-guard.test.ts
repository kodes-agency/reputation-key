// Tests for the request guard (BQC-7.6): body-size limit + x-request-id.
//
// The plugin is the nitro v3 wiring of two request-boundary controls:
//   - 413 short-circuit via h3's config.onRequest (the nitro `request`
//     runtime hook cannot short-circuit — nitro routes hook errors into
//     captureError and lets the request through, so the guard installs ahead
//     of it; a thrown web Response bypasses the h3 error handler and still
//     passes through the response hooks).
//   - x-request-id on every response via the nitro `response` hook.

import { describe, it, expect, vi } from 'vitest'
import {
  resolveRequestId,
  bodyLimitRejection,
  dataCellHostRejection,
  createRequestGuardPlugin,
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

describe('dataCellHostRejection', () => {
  it('allows the local canonical domain and non-canonical platform hosts', () => {
    expect(dataCellHostRejection('us.reputationkey.app', 'us')).toBeUndefined()
    expect(dataCellHostRejection('rep-key.up.railway.app', 'us')).toBeUndefined()
    expect(dataCellHostRejection('localhost:3000', 'us')).toBeUndefined()
  })

  it('returns a content-free 421 for another canonical Data Cell domain', async () => {
    const rejection = dataCellHostRejection('EU.REPUTATIONKEY.APP:443', 'us')
    expect(rejection?.status).toBe(421)
    await expect(rejection?.json()).resolves.toEqual({ error: 'wrong_cell' })
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

  it('installs an onRequest wrapper that throws a 413 Response for oversized bodies', () => {
    const { app, h3 } = fakeNitroApp()
    createRequestGuardPlugin({ bodyLimitBytes: 100, idGen: () => 'gid' })(app as never)
    expect(h3.config.onRequest).toBeTypeOf('function')
    try {
      h3.config.onRequest!(postWithLength('101'))
      expect.unreachable('oversized bodies must not reach the handler chain')
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(Response)
      expect((thrown as Response).status).toBe(413)
    }
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

  it('rejects another canonical Data Cell host before the handler chain', () => {
    const { app, h3 } = fakeNitroApp()
    const previous = vi.fn()
    h3.config.onRequest = previous
    createRequestGuardPlugin({
      bodyLimitBytes: 100,
      localCell: 'us',
      idGen: () => 'gid',
    })(app as never)
    const event = {
      req: new Request('https://eu.reputationkey.app/api/x'),
    }
    expect(() => h3.config.onRequest!(event)).toThrow()
    try {
      h3.config.onRequest!(event)
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(Response)
      expect((thrown as Response).status).toBe(421)
    }
    expect(previous).not.toHaveBeenCalled()
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
