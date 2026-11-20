import { describe, expect, it } from 'vitest'
import { dashboardErrorStatus } from './dashboard-error-status'

describe('dashboardErrorStatus', () => {
  it.each([
    ['forbidden', 403],
    ['not_found', 404],
    ['invalid_input', 400],
    ['too_many_portals', 422],
  ] as const)('answers %s with %i', (code, status) => {
    expect(dashboardErrorStatus(code)).toBe(status)
  })
})
