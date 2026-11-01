import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import * as functions from './staff-accounts'

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  policy: vi.fn(),
  invoke: vi.fn(),
  property: vi.fn(),
}))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const builder = { validator: () => builder, handler: (handler: unknown) => handler }
    return builder
  },
}))
vi.mock('#/shared/auth/middleware', () => ({ resolveTenantContext: mocks.resolve }))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: async () => new Headers(),
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.policy,
}))
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))
vi.mock('#/composition', () => ({
  getContainer: () => ({
    identityPublicApi: {
      staffAccounts: {
        checkStaffBatch: mocks.invoke,
        addStaffMember: mocks.invoke,
        resendStaffInvitation: mocks.invoke,
        removeStaffMember: mocks.invoke,
        renameStaffMember: mocks.invoke,
        listStaffMembers: mocks.invoke,
        setColleagueListEnabled: mocks.invoke,
        propertyForParticipation: mocks.property,
      },
    },
  }),
}))
const ctx = buildTestAuthContext()
const invoke = (fn: unknown, data: unknown) =>
  (fn as (input: { data: unknown }) => Promise<unknown>)({ data })
beforeEach(() => {
  vi.resetAllMocks()
  mocks.resolve.mockResolvedValue(ctx)
  mocks.property.mockResolvedValue('property')
  mocks.invoke.mockResolvedValue({ result: 'allowed' })
})

describe('staff management server policy boundary', () => {
  it.each([
    ['checkStaffBatch', 'staff.invite'],
    ['addStaffMember', 'staff.invite'],
    ['resendStaffInvitation', 'staff.invite'],
    ['removeStaffMember', 'staff.remove'],
    ['renameStaffMember', 'staff.invite'],
    ['listStaffMembers', 'staff.read'],
    ['setColleagueListEnabled', 'staff.settings'],
  ] as const)(
    '%s asks policy with the Property and the closed capability',
    async (name, action) => {
      const data = { propertyId: 'property', participationId: 'own' }
      expect(await invoke(functions[name], data)).toEqual({ result: 'allowed' })
      expect(mocks.policy).toHaveBeenCalledWith({
        actor: ctx,
        propertyId: 'property',
        action,
        capability: 'staff.accounts',
      })
      expect(mocks.policy.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.invoke.mock.invocationCallOrder[0]!,
      )
    },
  )
  it('never invokes a management command when capability policy refuses', async () => {
    mocks.policy.mockRejectedValue(new Error('Staff accounts are not available'))
    await expect(
      invoke(functions.addStaffMember, { propertyId: 'property' }),
    ).rejects.toThrow('Staff accounts are not available')
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
  it('maps a Portal preflight refusal once without hiding its actionable code', async () => {
    mocks.invoke.mockRejectedValue({
      _tag: 'PortalError',
      code: 'address_keyring_missing',
      message: 'Configure address recovery',
    })
    await expect(
      invoke(functions.addStaffMember, { propertyId: 'property' }),
    ).rejects.toMatchObject({ code: 'address_keyring_missing', status: 409 })
  })
})
