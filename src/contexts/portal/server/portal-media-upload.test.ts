// Portal context — the image upload endpoint: the HTTP edge of the ingest.
// It trusts nothing a browser sends and does the cheap refusals first: origin,
// session, capability and rate, before the body is read at all.

import { describe, expect, it, vi } from 'vitest'
import {
  createPortalMediaUploadHandler,
  isSameOriginRequest,
  type PortalMediaUploadDeps,
} from './portal-media-upload'
import { portalError } from '../domain/errors'
import { portalImageRejection } from '../domain/portal-image-policy'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { PORTAL_MEDIA_MAX_UPLOAD_BYTES } from '#/shared/domain/portal-media'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { RateLimiter } from '#/shared/rate-limit/middleware'

const NOW = new Date('2026-10-01T12:00:00Z')
const APP = 'https://app.example.test'
const PROPERTY = 'a0000000-0000-0000-0000-000000000001'
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])

const asset = {
  assetId: '11111111-1111-4111-8111-111111111111',
  purpose: 'hero',
  width: 2400,
  height: 1500,
  byteSize: 1234,
  contentType: 'image/webp',
} as const

const logger = (): LoggerPort => {
  const quiet: LoggerPort = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => quiet,
  }
  return quiet
}

const allowAll: RateLimiter = {
  check: async () => ({
    allowed: true,
    remaining: 1,
    resetAt: new Date(),
    backendStatus: 'available',
  }),
}

const setup = (overrides: Partial<PortalMediaUploadDeps> = {}) => {
  const ingest = vi.fn(async () => asset)
  const requireUploadAllowed = vi.fn(async () => {})
  const resolveContext = vi.fn(async () => buildTestAuthContext({ role: 'AccountAdmin' }))
  const check = vi.fn(allowAll.check)
  const handler = createPortalMediaUploadHandler({
    appOrigin: APP,
    resolveContext,
    requireUploadAllowed,
    rateLimiter: { check },
    clock: () => NOW,
    ingest,
    logger: logger(),
    ...overrides,
  })
  return { handler, ingest, requireUploadAllowed, resolveContext, check }
}

const upload = (
  query = `propertyId=${PROPERTY}&purpose=hero&rightsConfirmed=true`,
  init: {
    headers?: Record<string, string>
    body?: BodyInit | null
  } = {},
) =>
  new Request(`${APP}/api/portal-media?${query}`, {
    method: 'POST',
    headers: {
      'content-type': 'image/jpeg',
      'sec-fetch-site': 'same-origin',
      ...init.headers,
    },
    body: init.body === undefined ? JPEG : init.body,
  })

const json = async (response: Response) =>
  (await response.json()) as Record<string, unknown>

describe('isSameOriginRequest', () => {
  const headers = (entries: Record<string, string>) => new Headers(entries)

  it('accepts a browser that says the request is same-origin', () => {
    expect(isSameOriginRequest(headers({ 'sec-fetch-site': 'same-origin' }), APP)).toBe(
      true,
    )
  })

  it.each(['cross-site', 'same-site', 'none'])('refuses Sec-Fetch-Site %s', (value) => {
    expect(isSameOriginRequest(headers({ 'sec-fetch-site': value }), APP)).toBe(false)
  })

  it('without Sec-Fetch-Site, accepts only an Origin that is the app', () => {
    expect(isSameOriginRequest(headers({ origin: APP }), APP)).toBe(true)
    expect(isSameOriginRequest(headers({ origin: `${APP}/` }), APP)).toBe(true)
    expect(isSameOriginRequest(headers({ origin: 'https://evil.example' }), APP)).toBe(
      false,
    )
    expect(isSameOriginRequest(headers({ origin: 'null' }), APP)).toBe(false)
    expect(isSameOriginRequest(headers({ origin: `${APP}.evil.example` }), APP)).toBe(
      false,
    )
    expect(isSameOriginRequest(headers({}), APP)).toBe(false)
  })

  it('lets Sec-Fetch-Site override a forged Origin', () => {
    expect(
      isSameOriginRequest(headers({ 'sec-fetch-site': 'cross-site', origin: APP }), APP),
    ).toBe(false)
  })
})

describe('portal media upload endpoint', () => {
  it('stores the image and answers 201 with the asset, never with a key', async () => {
    const { handler, ingest } = setup()
    const response = await handler(upload())
    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await json(response)).toEqual({ asset })
    expect(JSON.stringify(asset)).not.toContain('portal-media/')
    expect(ingest).toHaveBeenCalledWith(
      {
        propertyId: PROPERTY,
        purpose: 'hero',
        declaredContentType: 'image/jpeg',
        bytes: JPEG,
        rightsConfirmed: true,
      },
      expect.objectContaining({ role: 'AccountAdmin' }),
    )
  })

  it('passes the Portal of a link tile through', async () => {
    const { handler, ingest } = setup()
    await handler(
      upload(
        `propertyId=${PROPERTY}&purpose=link_image&portalId=d0000000-0000-0000-0000-000000000001&rightsConfirmed=true`,
      ),
    )
    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'link_image',
        portalId: 'd0000000-0000-0000-0000-000000000001',
      }),
      expect.anything(),
    )
  })

  describe('refusals before the body is read', () => {
    const untouched = (mocks: ReturnType<typeof setup>) => {
      expect(mocks.ingest).not.toHaveBeenCalled()
    }

    it('a request from another origin, before the session is even looked at', async () => {
      const mocks = setup()
      const response = await mocks.handler(
        upload(undefined, { headers: { 'sec-fetch-site': 'cross-site' } }),
      )
      expect(response.status).toBe(403)
      expect(await json(response)).toEqual({ error: 'cross_origin' })
      expect(mocks.resolveContext).not.toHaveBeenCalled()
      untouched(mocks)
    })

    it('a caller with no session', async () => {
      const mocks = setup({
        resolveContext: async () => {
          throw new ServerFunctionError(
            'AuthError',
            'Valid session required',
            'unauthorized',
            401,
          )
        },
      })
      const response = await mocks.handler(upload())
      expect(response.status).toBe(401)
      expect(await json(response)).toEqual({ error: 'unauthorized' })
      untouched(mocks)
    })

    it('a capability that is switched off, without consuming the rate allowance', async () => {
      const mocks = setup({
        requireUploadAllowed: async () => {
          throw new ServerFunctionError(
            'AuthError',
            'Authorization denied: capability_safety_blocked',
            'capability_safety_blocked',
            403,
          )
        },
      })
      const response = await mocks.handler(upload())
      expect(response.status).toBe(403)
      expect(await json(response)).toEqual({ error: 'capability_safety_blocked' })
      expect(mocks.check).not.toHaveBeenCalled()
      untouched(mocks)
    })

    it('asks the capability about this Property and this purpose', async () => {
      const mocks = setup()
      await mocks.handler(upload())
      expect(mocks.requireUploadAllowed).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'AccountAdmin' }),
        PROPERTY,
        'hero',
      )
    })

    it('a caller over the rate allowance, with the retry time and no ingest', async () => {
      const resetAt = new Date(NOW.getTime() + 90_000)
      const mocks = setup({
        rateLimiter: {
          check: async () => ({
            allowed: false,
            remaining: 0,
            resetAt,
            backendStatus: 'available',
          }),
        },
      })
      const response = await mocks.handler(upload())
      expect(response.status).toBe(429)
      expect(response.headers.get('retry-after')).toBe('90')
      untouched(mocks)
    })

    it('a limiter that is down is not an allowance', async () => {
      const mocks = setup({
        rateLimiter: {
          check: async () => ({
            allowed: false,
            remaining: 0,
            resetAt: new Date(),
            backendStatus: 'unavailable',
          }),
        },
      })
      expect((await mocks.handler(upload())).status).toBe(503)
      untouched(mocks)
    })

    it('budgets per person and per Organization', async () => {
      const mocks = setup()
      await mocks.handler(upload())
      const keys = mocks.check.mock.calls.map(([key]) => key)
      expect(keys).toHaveLength(2)
      expect(keys[0]).toContain('actor')
      expect(keys[1]).toContain('organization')
    })

    it.each([
      ['no Property', 'purpose=hero&rightsConfirmed=true'],
      [
        'an unknown purpose',
        `propertyId=${PROPERTY}&purpose=banner&rightsConfirmed=true`,
      ],
      [
        'an oversized id',
        `propertyId=${'x'.repeat(200)}&purpose=hero&rightsConfirmed=true`,
      ],
      [
        'a rights flag that is not true',
        `propertyId=${PROPERTY}&purpose=hero&rightsConfirmed=maybe`,
      ],
    ])('%s', async (_name, query) => {
      const mocks = setup()
      const response = await mocks.handler(upload(query))
      expect(response.status).toBe(400)
      expect(await json(response)).toEqual({ error: 'invalid_request' })
      untouched(mocks)
    })

    it('a missing rights flag is passed on as not confirmed, for the use case to refuse', async () => {
      const mocks = setup()
      await mocks.handler(upload(`propertyId=${PROPERTY}&purpose=hero`))
      expect(mocks.ingest).toHaveBeenCalledWith(
        expect.objectContaining({ rightsConfirmed: false }),
        expect.anything(),
      )
    })

    it('a declared length over the limit, without reading a byte', async () => {
      const mocks = setup()
      const response = await mocks.handler(
        upload(undefined, {
          headers: { 'content-length': String(PORTAL_MEDIA_MAX_UPLOAD_BYTES + 1) },
        }),
      )
      expect(response.status).toBe(413)
      untouched(mocks)
    })
  })

  describe('the body', () => {
    it('is cut off at the limit when it declares no length', async () => {
      const mocks = setup()
      const chunk = new Uint8Array(1024 * 1024)
      let sent = 0
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent > PORTAL_MEDIA_MAX_UPLOAD_BYTES + chunk.length)
            return controller.close()
          sent += chunk.length
          controller.enqueue(chunk)
        },
      })
      const response = await mocks.handler(
        new Request(
          `${APP}/api/portal-media?propertyId=${PROPERTY}&purpose=hero&rightsConfirmed=true`,
          {
            method: 'POST',
            headers: { 'content-type': 'image/jpeg', 'sec-fetch-site': 'same-origin' },
            body: stream,
            duplex: 'half',
          } as RequestInit,
        ),
      )
      expect(response.status).toBe(413)
      expect(sent).toBeLessThanOrEqual(PORTAL_MEDIA_MAX_UPLOAD_BYTES + 2 * chunk.length)
      expect(mocks.ingest).not.toHaveBeenCalled()
    })

    it('hands the declared type to the ingest, which checks it against the bytes', async () => {
      const mocks = setup()
      await mocks.handler(upload(undefined, { headers: { 'content-type': 'image/png' } }))
      expect(mocks.ingest).toHaveBeenCalledWith(
        expect.objectContaining({ declaredContentType: 'image/png' }),
        expect.anything(),
      )
    })

    it('an upload with no Content-Type is declared as nothing', async () => {
      const mocks = setup()
      await mocks.handler(
        new Request(
          `${APP}/api/portal-media?propertyId=${PROPERTY}&purpose=hero&rightsConfirmed=true`,
          {
            method: 'POST',
            headers: { 'sec-fetch-site': 'same-origin' },
            body: JPEG,
          },
        ),
      )
      const declared = mocks.ingest.mock.calls[0] as unknown as [
        { declaredContentType: string },
      ]
      expect(declared[0].declaredContentType).not.toMatch(/^image\//)
    })
  })

  describe('what the ingest refuses', () => {
    const refusedWith = async (error: unknown) => {
      const mocks = setup({
        ingest: async () => {
          throw error
        },
      })
      const response = await mocks.handler(upload())
      return { status: response.status, body: await json(response) }
    }

    it.each([
      ['too_large', 413],
      ['unsupported_type', 415],
      ['type_mismatch', 415],
      ['rights_not_confirmed', 400],
      ['asset_limit_reached', 409],
      ['animated', 422],
      ['too_small', 422],
      ['too_many_pixels', 422],
      ['extreme_aspect', 422],
      ['undecodable', 422],
      ['output_too_large', 422],
      ['empty', 422],
    ] as const)('an image refused as %s is a %i', async (reason, status) => {
      expect(await refusedWith(portalImageRejection(reason))).toEqual({
        status,
        body: { error: 'image_rejected', reason },
      })
    })

    it('a Portal or Property that is not there is a 404', async () => {
      expect(await refusedWith(portalError('portal_not_found', 'x'))).toEqual({
        status: 404,
        body: { error: 'portal_not_found' },
      })
      expect(await refusedWith(portalError('property_not_found', 'x'))).toMatchObject({
        status: 404,
      })
    })

    it('a role without the permission is a 403', async () => {
      expect(await refusedWith(portalError('forbidden', 'No access'))).toMatchObject({
        status: 403,
        body: { error: 'forbidden' },
      })
    })

    it('a storage failure is a 422 that names nothing about the store', async () => {
      const result = await refusedWith(
        portalError('upload_failed', 'S3 bucket x is down'),
      )
      expect(result.status).toBe(422)
      expect(JSON.stringify(result.body)).not.toContain('S3')
    })

    it('anything unexpected is a bare 500 with no detail', async () => {
      const result = await refusedWith(new Error('connect ECONNREFUSED 10.0.0.4:5432'))
      expect(result).toEqual({ status: 500, body: { error: 'internal_error' } })
    })
  })
})
