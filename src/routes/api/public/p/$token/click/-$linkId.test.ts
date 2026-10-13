import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { ServerFunctionError } from '#/shared/auth/server-function-error'

const mocks = vi.hoisted(() => ({
  resolvePublicPortalLink: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  capture: vi.fn(),
}))

vi.mock('#/contexts/guest/server/guest-scans', () => ({
  resolvePublicPortalLink: mocks.resolvePublicPortalLink,
}))
vi.mock('#/shared/observability/logger', () => ({
  getLogger: vi.fn(() => ({ warn: mocks.warn, error: mocks.error })),
}))
vi.mock('#/shared/observability/telemetry', () => ({
  captureObservabilityException: mocks.capture,
}))

import { handlePublicPortalClick } from './$linkId'

/** What the server function throws when its lookup fails: a sanitised 500. */
const lookupOutage = () =>
  new ServerFunctionError('InternalError', 'Internal server error', 'internal_error', 500)

describe('GET /api/public/p/$token/click/$linkId', () => {
  beforeEach(() => vi.clearAllMocks())

  it('binds the opaque token and link ID before redirecting to the stored HTTPS URL', async () => {
    mocks.resolvePublicPortalLink.mockResolvedValue({
      url: 'https://reviews.example.com/r',
    })

    const response = await handlePublicPortalClick({
      token: 'token-p1',
      linkId: 'link-p1',
    })

    expect(mocks.resolvePublicPortalLink).toHaveBeenCalledWith({
      data: { token: 'token-p1', linkId: 'link-p1' },
    })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://reviews.example.com/r')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('returns an inert non-enumerating response for a forged cross-property link', async () => {
    mocks.resolvePublicPortalLink.mockResolvedValue(null)

    const response = await handlePublicPortalClick({
      token: 'token-p2',
      linkId: 'link-p1',
    })

    expect(response.status).toBe(404)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('answers a failed lookup as an outage, not as a link that does not exist', async () => {
    mocks.resolvePublicPortalLink.mockRejectedValue(lookupOutage())

    const response = await handlePublicPortalClick({
      token: 'token-p1',
      linkId: 'link-p1',
    })

    expect(response.status).toBe(503)
    expect(await response.text()).toBe('Link temporarily unavailable')
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('reports a failed lookup to the error monitor', async () => {
    mocks.resolvePublicPortalLink.mockRejectedValue(lookupOutage())

    await handlePublicPortalClick({ token: 'token-p1', linkId: 'link-p1' })

    expect(mocks.capture).toHaveBeenCalledTimes(1)
    const [reported, context] = mocks.capture.mock.calls[0] ?? []
    expect(reported).toMatchObject({
      name: 'PublicPortalClickUnavailable',
      message: 'public_portal_click_unavailable',
    })
    expect(context).toEqual({ source: 'nitro' })
  })

  it('does not disclose a retired token in logs, the report or redirect effects', async () => {
    mocks.resolvePublicPortalLink.mockRejectedValue(
      new Error('lookup failed for raw-secret-token'),
    )

    const response = await handlePublicPortalClick({
      token: 'raw-secret-token',
      linkId: 'link-p1',
    })

    expect(response.status).toBe(503)
    expect(response.headers.get('location')).toBeNull()
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain('raw-secret-token')
    expect(mocks.error).toHaveBeenCalledWith(
      { linkId: 'link-p1', errorCode: 'public_portal_click_unavailable' },
      '[handler] public Portal click unavailable',
    )
    // The report is a marker made here: the upstream error is not its message,
    // not its cause and not a property of it.
    const [reported] = mocks.capture.mock.calls[0] ?? []
    expect(reported).toBeInstanceOf(Error)
    expect((reported as Error).cause).toBeUndefined()
    expect(JSON.stringify(reported, Object.getOwnPropertyNames(reported))).not.toContain(
      'raw-secret-token',
    )
  })

  it.each([
    ['a Portal that is not found', 'portal_not_found', 404],
    ['a Portal that is no longer active', 'portal_inactive', 410],
    ['a caller over its rate limit', 'rate_limit_exceeded', 429],
  ] as const)(
    'keeps the inert 404 for %s and reports nothing',
    async (_name, code, status) => {
      mocks.resolvePublicPortalLink.mockRejectedValue(
        new ServerFunctionError('GuestError', 'refused', code, status),
      )

      const response = await handlePublicPortalClick({
        token: 'token-p1',
        linkId: 'link-p1',
      })

      expect(response.status).toBe(404)
      expect(await response.text()).toBe('Link not found')
      expect(mocks.capture).not.toHaveBeenCalled()
      expect(mocks.error).not.toHaveBeenCalled()
    },
  )

  it('keeps the inert 404 for an address the lookup refuses to read', async () => {
    const refused = z
      .object({ token: z.string().max(4) })
      .safeParse({ token: 'too-long' })
    mocks.resolvePublicPortalLink.mockRejectedValue(refused.error)

    const response = await handlePublicPortalClick({
      token: 'too-long',
      linkId: 'link-p1',
    })

    expect(response.status).toBe(404)
    expect(mocks.capture).not.toHaveBeenCalled()
  })
})
