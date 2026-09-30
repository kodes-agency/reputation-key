import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { identityError } from '../domain/errors'

const CTX = { userId: 'user-admin', organizationId: 'org-1', role: 'AccountAdmin' }
const PROPERTY_A = '00000000-0000-4000-8000-00000000000a'

const mocks = vi.hoisted(() => ({
  listMemberPropertyAccess: vi.fn(),
  setMemberPropertyAccess: vi.fn(),
  requireExecutionAllowed: vi.fn(),
  resetTenantCache: vi.fn(),
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({
    identityPublicApi: {
      requests: {
        listMemberPropertyAccess: mocks.listMemberPropertyAccess,
        setMemberPropertyAccess: mocks.setMemberPropertyAccess,
      },
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
  requireExecutionAllowed: mocks.requireExecutionAllowed,
}))
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))

import {
  listMemberPropertyAccess,
  setMemberPropertyAccess,
} from './organizations.member-access'

describe('member Property access server handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists access under the member.update execution policy', async () => {
    mocks.listMemberPropertyAccess.mockResolvedValue({
      access: [{ userId: 'user-pm', propertyIds: [PROPERTY_A] }],
    })

    await withStartContext(() => listMemberPropertyAccess())

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: CTX,
      action: 'member.update',
    })
    expect(mocks.listMemberPropertyAccess).toHaveBeenCalledWith(undefined, CTX)
  })

  it('applies a validated change and drops cached tenant scope', async () => {
    mocks.setMemberPropertyAccess.mockResolvedValue({
      grantedPropertyIds: [PROPERTY_A],
      revokedPropertyIds: [],
    })

    await withStartContext(() =>
      setMemberPropertyAccess({
        data: { memberId: 'member-pm', grantPropertyIds: [PROPERTY_A] },
      }),
    )

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: CTX,
      action: 'member.update',
    })
    // The validator runs on the RPC server path, which a direct call skips.
    expect(mocks.setMemberPropertyAccess).toHaveBeenCalledWith(
      { memberId: 'member-pm', grantPropertyIds: [PROPERTY_A] },
      CTX,
    )
    expect(mocks.resetTenantCache).toHaveBeenCalledOnce()
  })

  it('maps a refused change to its stable 4xx response and keeps the cache', async () => {
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
