import { describe, expect, it, vi } from 'vitest'
import { buildTestAuthContext } from '#/shared/testing/fixtures'

const mocks = vi.hoisted(() => ({ members: vi.fn(), resolve: vi.fn(), policy: vi.fn() }))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({ handler: (handler: unknown) => handler }),
}))
vi.mock('#/shared/observability/traced-server-fn', () => ({
  tracedHandler: (handler: unknown) => handler,
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: async () => new Headers(),
}))
vi.mock('#/shared/auth/middleware', () => ({ resolveTenantContext: mocks.resolve }))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.policy,
}))
vi.mock('#/composition', () => ({
  getContainer: () => ({ identityPort: { listMembers: mocks.members } }),
}))
import { listMembers } from './organizations.query'

describe('Settings member directory', () => {
  it('omits staff-only logins while retaining managers and their directory fields', async () => {
    mocks.resolve.mockResolvedValue(buildTestAuthContext({ role: 'AccountAdmin' }))
    const manager = {
      id: 'manager',
      userId: 'user-manager',
      role: 'PropertyManager',
      rawRole: 'admin',
      email: 'manager@example.com',
      name: 'Manager',
      image: null,
      createdAt: new Date('2026-01-01'),
    }
    mocks.members.mockResolvedValue([
      manager,
      { ...manager, id: 'staff', userId: 'staff', role: 'Member', rawRole: 'member' },
    ])
    const invoke = listMembers as unknown as () => Promise<unknown>
    expect(await invoke()).toEqual({ members: [manager], requestingRole: 'AccountAdmin' })
    expect(mocks.policy).toHaveBeenCalledWith({
      actor: expect.any(Object),
      action: 'member.list',
    })
  })
})
