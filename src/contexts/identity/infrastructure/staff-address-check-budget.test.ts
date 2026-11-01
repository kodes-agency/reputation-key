import { describe, expect, it, vi } from 'vitest'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { createStaffAddressCheckBudget } from './staff-address-check-budget'

describe('staff address check admission', () => {
  it('spends per row from a separate, pseudonymous 200-unit hourly actor budget', async () => {
    let spent = 0
    const check = vi.fn(async () => ({
      allowed: ++spent <= 200,
      remaining: Math.max(0, 200 - spent),
      resetAt: new Date(),
      backendStatus: 'available' as const,
    }))
    const spend = createStaffAddressCheckBudget({ check }, 'test-secret')
    const ctx = buildTestAuthContext()
    for (let batch = 0; batch < 10; batch += 1) await spend(ctx, 20)
    await expect(spend(ctx, 1)).rejects.toMatchObject({ code: 'rate_limited' })
    const [key, limit] = check.mock.calls[0] as unknown as [string, object]
    expect(key).toMatch(/^identity:staff-address-check:actor:[a-f0-9]{64}$/)
    expect(key).not.toContain(ctx.userId)
    expect(limit).toEqual({ maxRequests: 200, windowSeconds: 3600 })
  })
})
