import { describe, expect, it, vi } from 'vitest'

const decide = vi.hoisted(() => vi.fn())
vi.mock('#/shared/auth/execution-policy', () => ({ decidePublicExecution: decide }))

import { isAcceptanceAdmitted } from './invitation-admission'

const NOW = new Date('2026-07-01T00:00:00Z')

describe('isAcceptanceAdmitted', () => {
  it('asks the execution policy about acceptance under the given capability', async () => {
    decide.mockResolvedValue({ allowed: true })
    expect(await isAcceptanceAdmitted('identity.invite', 'org-1', NOW)).toBe(true)
    expect(decide).toHaveBeenCalledWith({
      action: 'system:identity.accept_invitation',
      capability: 'identity.invite',
      organizationId: 'org-1',
      now: NOW,
    })
  })

  it('refuses when the policy refuses', async () => {
    decide.mockResolvedValue({ allowed: false, reason: 'org_suspended' })
    expect(await isAcceptanceAdmitted('staff.accounts', 'org-1', NOW)).toBe(false)
  })
})
