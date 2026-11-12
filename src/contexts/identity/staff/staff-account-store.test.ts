import { describe, expect, it, vi } from 'vitest'
import { createStaffInvitationBudget } from '../infrastructure/staff-invitation-budget'
import { buildTestAuthContext } from '#/shared/testing/fixtures'

describe('staff invitation budget binding', () => {
  it('reads without spending and reports a refused spend as an actionable staff error', async () => {
    const ctx = buildTestAuthContext()
    const check = vi.fn(async () => ({
      allowed: false,
      remaining: 0,
      resetAt: new Date(),
      backendStatus: 'available' as const,
    }))
    const remaining = vi.fn(async () => 7)
    const budget = createStaffInvitationBudget({ check, remaining }, 'test-secret')
    expect(await budget.remaining(ctx)).toBe(7)
    expect(check).not.toHaveBeenCalled()
    await expect(budget.spend(ctx)).rejects.toMatchObject({ code: 'rate_limited' })
  })
})
