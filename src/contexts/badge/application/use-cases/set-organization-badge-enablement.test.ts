// Badge context — set organization badge enablement use case tests
// Covers Fix 5: the use case gates on can(role, 'badge.manage') as the primary
// authorization check (server fn keeps a defense-in-depth check too).

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { setPermissionLookup } from '#/shared/domain/permissions'
import { setOrganizationBadgeEnablement } from './set-organization-badge-enablement'
import { isBadgeError } from '../../domain/errors'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import type { BadgeRepository } from '../ports/badge.repository'
import type { OrganizationBadgeEnablement } from '../../domain/types'
import {
  badgeId,
  organizationBadgeEnablementId,
  organizationId,
} from '#/shared/domain/ids'

const ORG = organizationId('org-1')
const BADGE = badgeId('00000000-0000-4000-8000-000000000001')

function makeRepo(returned: OrganizationBadgeEnablement): {
  repo: BadgeRepository
  setOrganizationEnablement: Mock
} {
  const setOrganizationEnablement = vi.fn(async () => returned)
  const repo = {
    setOrganizationEnablement,
  } as unknown as BadgeRepository
  return { repo, setOrganizationEnablement }
}

const RETURNED: OrganizationBadgeEnablement = {
  id: organizationBadgeEnablementId('00000000-0000-4000-8000-0000000000ee'),
  organizationId: ORG,
  badgeDefinitionId: BADGE,
  enabled: true,
  createdAt: new Date('2026-07-01T00:00:00Z'),
  updatedAt: new Date('2026-07-01T00:00:00Z'),
}

describe('setOrganizationBadgeEnablement — authorization gate', () => {
  beforeEach(() => {
    setPermissionLookup(() => true)
  })

  it('throws forbidden when the role lacks badge.manage', async () => {
    // Simulate a Staff role: can(role, 'badge.manage') === false.
    setPermissionLookup(() => false)
    const { repo, setOrganizationEnablement } = makeRepo(RETURNED)
    const useCase = setOrganizationBadgeEnablement({ badgeRepo: repo })
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(
      useCase({ organizationId: ORG, badgeDefinitionId: BADGE, enabled: true }, ctx),
    ).rejects.toSatisfy((e) => isBadgeError(e) && e.code === 'forbidden')

    expect(setOrganizationEnablement).not.toHaveBeenCalled()
  })

  it('persists enablement when the role has badge.manage', async () => {
    setPermissionLookup(() => true)
    const { repo, setOrganizationEnablement } = makeRepo(RETURNED)
    const useCase = setOrganizationBadgeEnablement({ badgeRepo: repo })
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const result = await useCase(
      { organizationId: ORG, badgeDefinitionId: BADGE, enabled: false },
      ctx,
    )

    expect(result).toBe(RETURNED)
    expect(setOrganizationEnablement).toHaveBeenCalledWith(ORG, BADGE, false)
  })
})
