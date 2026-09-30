import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withStartContext } from '#/shared/testing/tanstack-start-als'

const mocks = vi.hoisted(() => ({
  getInvitationPreview: vi.fn(),
  rateLimitCheck: vi.fn(),
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({
    identityPublicApi: {
      requests: { getInvitationPreview: mocks.getInvitationPreview },
    },
    rateLimiter: { check: mocks.rateLimitCheck },
  }),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers()),
}))
vi.mock('#/shared/security/client-ip', () => ({
  clientIpFromHeaders: () => '198.51.100.7',
}))
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))

import { getInvitationPreviewHandler } from './invitation-preview'

const preview = (invitationId = 'inv-link-1') =>
  withStartContext(() => getInvitationPreviewHandler({ data: { invitationId } }))

describe('getInvitationPreview server function', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rateLimitCheck.mockResolvedValue({ allowed: true })
    mocks.getInvitationPreview.mockResolvedValue({ state: 'unavailable' })
  })

  it('returns the preview for the link, rate-limited per IP', async () => {
    await expect(preview()).resolves.toEqual({ state: 'unavailable' })

    expect(mocks.rateLimitCheck).toHaveBeenCalledWith(
      'identity:invitation-preview:198.51.100.7',
      { maxRequests: 60, windowSeconds: 600 },
    )
    expect(mocks.getInvitationPreview).toHaveBeenCalledWith('inv-link-1')
  })

  it('refuses with 429 over the limit and reads nothing', async () => {
    mocks.rateLimitCheck.mockResolvedValue({ allowed: false })

    await expect(preview()).rejects.toMatchObject({
      name: 'AuthError',
      code: 'rate_limited',
      status: 429,
    })
    expect(mocks.getInvitationPreview).not.toHaveBeenCalled()
  })
})
