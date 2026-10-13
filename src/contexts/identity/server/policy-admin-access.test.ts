// The operator grant and revoke server functions map a refusal by its tag and
// code. A failure that carries no tag is an internal error whatever its message
// says: a database fault quotes the statement and its parameters, and one of
// those parameters is the reason the caller typed.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthContext } from '#/shared/domain/auth-context'
import { identityError } from '../domain/errors'

const NOW = new Date('2026-10-13T10:00:00.000Z')
const PROPERTY_ID = '00000000-0000-4000-8000-000000000606'

const actor = {
  organizationId: 'org-policy-admin',
  userId: 'admin-policy-admin',
  role: 'AccountAdmin',
} as unknown as AuthContext

const mocks = vi.hoisted(() => ({
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
  grantPropertyAccessOp: vi.fn(),
  revokePropertyAccessOp: vi.fn(),
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const builder = {
      validator: () => builder,
      handler:
        (fn: (context: { data: unknown }) => Promise<unknown>) =>
        (options: { data?: unknown } = {}) =>
          fn({ data: options.data }),
    }
    return builder
  },
}))

vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers()),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.requireExecutionAllowed,
}))
vi.mock('#/composition', () => ({
  getContainer: () => ({
    clock: () => NOW,
    policyAdmin: {
      grantPropertyAccessOp: mocks.grantPropertyAccessOp,
      revokePropertyAccessOp: mocks.revokePropertyAccessOp,
    },
  }),
}))

import { grantPropertyAccessFn, revokePropertyAccessFn } from './policy-admin'

const grant = () =>
  grantPropertyAccessFn({
    data: {
      userId: 'user-manager',
      propertyId: PROPERTY_ID,
      reason: 'covering for holiday',
      ticketRef: 'OPS-606',
    },
  })

const revoke = (reason: string) =>
  revokePropertyAccessFn({
    data: { userId: 'user-manager', propertyId: PROPERTY_ID, reason },
  })

/** What a driver fault looks like once the query builder has wrapped it. */
const databaseFault = (reason: string) =>
  new Error(
    `Failed query: update "property_access_grant" set "revoke_reason" = $1\nparams: ${reason}`,
  )

describe('operator Property access server functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(actor)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
    mocks.grantPropertyAccessOp.mockResolvedValue(undefined)
    mocks.revokePropertyAccessOp.mockResolvedValue(undefined)
  })

  it('answers a grant to someone outside the Organization as not found', async () => {
    mocks.grantPropertyAccessOp.mockRejectedValue(
      identityError('member_not_found', 'The user is not a member of this organization'),
    )

    await expect(grant()).rejects.toMatchObject({
      name: 'IdentityError',
      code: 'member_not_found',
      status: 404,
      message: 'The user is not a member of this organization',
    })
  })

  it('answers a refused revoke as the validation error it is', async () => {
    mocks.revokePropertyAccessOp.mockRejectedValue(
      identityError('validation_error', 'The property is not in this organization'),
    )

    await expect(revoke('cover ended')).rejects.toMatchObject({
      name: 'IdentityError',
      code: 'validation_error',
      status: 400,
    })
  })

  it('does not read an untagged failure as a refusal because of its wording', async () => {
    const reason = 'no longer required'
    mocks.revokePropertyAccessOp.mockRejectedValue(databaseFault(reason))

    const failure = await revoke(reason).then(
      () => null,
      (error: unknown) => error as Error & { code: string; status: number },
    )

    expect(failure).toMatchObject({
      name: 'InternalError',
      code: 'internal_error',
      status: 500,
      message: 'Internal server error',
    })
  })

  it('sanitizes an untagged grant failure the same way', async () => {
    mocks.grantPropertyAccessOp.mockRejectedValue(
      new Error('relation "member" was not found in organization schema'),
    )

    await expect(grant()).rejects.toMatchObject({
      name: 'InternalError',
      status: 500,
      message: 'Internal server error',
    })
  })
})
