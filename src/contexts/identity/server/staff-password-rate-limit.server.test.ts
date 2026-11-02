import { expect, it, vi } from 'vitest'
import {
  assertStaffPasswordBudget,
  staffPasswordFailureKey,
  STAFF_PASSWORD_FAILURE_LIMIT,
} from './staff-password-rate-limit.server'
it('checks ten failed attempts an hour for the signed-in person, without spending a success', async () => {
  const remaining = vi.fn().mockResolvedValue(1),
    check = vi.fn()
  await expect(
    assertStaffPasswordBudget({ remaining, check }, 'polly'),
  ).resolves.toBeUndefined()
  expect(remaining).toHaveBeenCalledWith(staffPasswordFailureKey('polly'), {
    maxRequests: 10,
    windowSeconds: 3600,
  })
  expect(check).not.toHaveBeenCalled()
  remaining.mockResolvedValue(0)
  await expect(
    assertStaffPasswordBudget({ remaining, check }, 'polly'),
  ).rejects.toMatchObject({ code: 'rate_limited', status: 429 })
  expect(STAFF_PASSWORD_FAILURE_LIMIT.maxRequests).toBe(10)
  expect(staffPasswordFailureKey('ana')).not.toBe(staffPasswordFailureKey('polly'))
})
