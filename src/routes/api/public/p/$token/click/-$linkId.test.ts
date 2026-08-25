import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolvePublicPortalLink: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('#/contexts/guest/server/guest-scans', () => ({
  resolvePublicPortalLink: mocks.resolvePublicPortalLink,
}))
vi.mock('#/shared/observability/logger', () => ({
  getLogger: vi.fn(() => ({ warn: mocks.warn, error: mocks.error })),
}))

import { handlePublicPortalClick } from './$linkId'

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
  })

  it('does not disclose a retired token in logs or redirect effects', async () => {
    mocks.resolvePublicPortalLink.mockRejectedValue(new Error('token unavailable'))

    const response = await handlePublicPortalClick({
      token: 'raw-secret-token',
      linkId: 'link-p1',
    })

    expect(response.status).toBe(404)
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain('raw-secret-token')
  })
})
