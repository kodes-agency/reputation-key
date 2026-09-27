import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { identityError } from '../domain/errors'

const mocks = vi.hoisted(() => ({
  acceptInvitation: vi.fn(),
  requireAuth: vi.fn(),
  resetTenantCache: vi.fn(),
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({
    identityPublicApi: {
      requests: { acceptInvitation: mocks.acceptInvitation },
    },
  }),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers({ cookie: 'session=current' })),
}))
vi.mock('#/shared/auth/middleware', () => ({
  requireAuth: mocks.requireAuth,
  resolveTenantContext: vi.fn(),
  resetTenantCache: mocks.resetTenantCache,
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: vi.fn(),
}))
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))

import { acceptInvitation } from './organizations.invitations'

describe('invitation server handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAuth.mockResolvedValue({ id: 'user-1' })
  })

  it('maps a tagged invitation failure to its stable 4xx response', async () => {
    mocks.acceptInvitation.mockRejectedValue(
      identityError('invitation_not_found', 'Invitation is invalid or expired'),
    )

    await expect(
      withStartContext(() =>
        acceptInvitation({
          data: { invitationId: '0198db6a-dc93-7d85-aa08-d75669070e80' },
        }),
      ),
    ).rejects.toMatchObject({
      name: 'IdentityError',
      code: 'invitation_not_found',
      status: 404,
    })
    expect(mocks.resetTenantCache).not.toHaveBeenCalled()
  })
})
