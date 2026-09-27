import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  changePassword: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
}))

vi.mock('#/shared/auth/auth', () => ({
  getAuth: () => ({ api: { changePassword: mocks.changePassword } }),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers({ cookie: 'session=current' })),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.requireExecutionAllowed,
}))
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))

import { changePasswordFn } from './auth-settings'

describe('auth settings handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue({
      organizationId: 'org-1',
      userId: 'user-1',
      role: 'AccountAdmin',
    })
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
    mocks.changePassword.mockResolvedValue({ token: 'rotated-current-session' })
  })

  it('revokes every other session when an authenticated user changes password', async () => {
    await withStartContext(() =>
      changePasswordFn({
        data: {
          currentPassword: 'old-password',
          newPassword: 'new-password-123',
        },
      }),
    )

    expect(mocks.changePassword).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: {
        currentPassword: 'old-password',
        newPassword: 'new-password-123',
        revokeOtherSessions: true,
      },
    })
  })
})
