// The harness cannot provoke a failure after a grant change has committed, so
// the cached-scope contract on the failure branches is pinned here with a
// stubbed Identity request.
import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { identityError } from '../domain/errors'

const CTX = { userId: 'user-admin', organizationId: 'org-1', role: 'AccountAdmin' }
const PROPERTY_A = '00000000-0000-4000-8000-00000000000a'

const mocks = vi.hoisted(() => ({
  setMemberPropertyAccess: vi.fn(),
  resetTenantCache: vi.fn(),
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({
    identityPublicApi: {
      requests: { setMemberPropertyAccess: mocks.setMemberPropertyAccess },
    },
  }),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers({ cookie: 'session=current' })),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: vi.fn(async () => CTX),
  resetTenantCache: mocks.resetTenantCache,
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: vi.fn(),
}))
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))

import { setMemberPropertyAccess } from './organizations.member-access'

describe('setMemberPropertyAccess cached tenant scope on failure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('drops the cached scope when an untagged failure may follow a committed change', async () => {
    // The responsibility reconcile runs after the grants commit, so an
    // untagged failure does not mean nothing changed.
    mocks.setMemberPropertyAccess.mockRejectedValue(
      new Error('temporary reconciliation failure'),
    )

    await expect(
      withStartContext(() =>
        setMemberPropertyAccess({
          data: { memberId: 'member-pm', revokePropertyIds: [PROPERTY_A] },
        }),
      ),
    ).rejects.toMatchObject({ code: 'internal_error', status: 500 })
    expect(mocks.resetTenantCache).toHaveBeenCalledOnce()
  })

  it('keeps the cached scope when Identity refuses the change', async () => {
    mocks.setMemberPropertyAccess.mockRejectedValue(
      identityError('validation_error', 'Account Admins can access every property'),
    )

    await expect(
      withStartContext(() =>
        setMemberPropertyAccess({
          data: { memberId: 'member-admin', grantPropertyIds: [PROPERTY_A] },
        }),
      ),
    ).rejects.toMatchObject({
      name: 'IdentityError',
      code: 'validation_error',
      status: 400,
    })
    expect(mocks.resetTenantCache).not.toHaveBeenCalled()
  })
})
