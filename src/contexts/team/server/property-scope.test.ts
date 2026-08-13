import { beforeEach, describe, expect, it, vi } from 'vitest'
import { teamError } from '../domain/errors'
import { organizationId, userId } from '#/shared/domain/ids'

const mocks = vi.hoisted(() => ({
  requireExecutionAllowed: vi.fn(),
}))

vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.requireExecutionAllowed,
}))

import {
  requireMatchingTeamResourceScopes,
  requireTeamResourceScope,
} from './property-scope'

const ACTOR = {
  userId: userId('user-1'),
  organizationId: organizationId('org-a'),
  role: 'PropertyManager',
} as const

const operation = {
  actor: ACTOR,
  action: 'team.membership.manage' as const,
}

describe('Team property execution scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireExecutionAllowed.mockImplementation(async ({ propertyId }) => {
      if (propertyId !== 'property-p1') throw new Error('policy_denied')
    })
  })

  it('authorizes a P1 team against its authoritative property', async () => {
    await expect(
      requireTeamResourceScope({
        ...operation,
        notFound: teamError('team_not_found', 'team not found'),
        lookup: async () => ({ organizationId: 'org-a', propertyId: 'property-p1' }),
      }),
    ).resolves.toMatchObject({ propertyId: 'property-p1' })

    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      ...operation,
      propertyId: 'property-p1',
    })
  })

  it('denies a direct P2 team before membership effects', async () => {
    let effects = 0

    await expect(
      requireTeamResourceScope({
        ...operation,
        notFound: teamError('team_not_found', 'team not found'),
        lookup: async () => ({ organizationId: 'org-a', propertyId: 'property-p2' }),
      }).then(() => {
        effects += 1
      }),
    ).rejects.toThrow('policy_denied')

    expect(effects).toBe(0)
  })

  it('does not disclose a wrong-organization team through policy evaluation', async () => {
    const notFound = teamError('team_not_found', 'team not found')

    await expect(
      requireTeamResourceScope({
        ...operation,
        notFound,
        lookup: async () => ({ organizationId: 'org-b', propertyId: 'property-p1' }),
      }),
    ).rejects.toBe(notFound)

    expect(mocks.requireExecutionAllowed).not.toHaveBeenCalled()
  })

  it('rejects a forged participation from another property before policy or effects', async () => {
    const notFound = teamError('participation_not_found', 'participation not found')

    await expect(
      requireMatchingTeamResourceScopes({
        ...operation,
        notFound,
        lookups: [
          async () => ({ organizationId: 'org-a', propertyId: 'property-p1' }),
          async () => ({ organizationId: 'org-a', propertyId: 'property-p2' }),
        ],
      }),
    ).rejects.toBe(notFound)

    expect(mocks.requireExecutionAllowed).not.toHaveBeenCalled()
  })
})
