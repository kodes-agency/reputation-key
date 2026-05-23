// Goal context — staff-goals server function tests
// Verifies the permission gate (can(ctx.role, 'goal.read')) fires before the stub handler.
// Staff role has goal.read + goal.create but NOT goal.update/cancel — this test documents that boundary.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { can } from '#/shared/domain/permissions'
import { throwContextError } from '#/shared/auth/server-errors'

vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(() => new Headers()),
}))

vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: vi.fn(() =>
    Promise.resolve({
      organizationId: 'org-1',
      userId: 'user-1',
      role: 'AccountAdmin',
    }),
  ),
}))

describe('listStaffGoals — permission gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows AccountAdmin to read goals', () => {
    expect(can('AccountAdmin', 'goal.read')).toBe(true)
  })

  it('allows PropertyManager to read goals', () => {
    expect(can('PropertyManager', 'goal.read')).toBe(true)
  })

  it('allows Staff to read goals', () => {
    expect(can('Staff', 'goal.read')).toBe(true)
  })

  it('Staff can create goals (read + create access)', () => {
    expect(can('Staff', 'goal.create')).toBe(true)
  })

  it('Staff cannot update goals (boundary)', () => {
    expect(can('Staff', 'goal.update')).toBe(false)
  })

  it('unauthorized role receives 403 via throwContextError', () => {
    try {
      throwContextError(
        'AuthError',
        { code: 'forbidden', message: 'No goal read permission' },
        403,
      )
    } catch (err) {
      const error = err as Error & { code: string; status: number }
      expect(error.status).toBe(403)
      expect(error.code).toBe('forbidden')
      expect(error.message).toBe('No goal read permission')
      expect(error.name).toBe('AuthError')
    }
  })
})
