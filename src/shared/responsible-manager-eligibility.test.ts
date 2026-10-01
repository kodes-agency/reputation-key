import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, userId, type PropertyId } from '#/shared/domain/ids'
import {
  isEligibleResponsibleManager,
  listEligibleResponsibleManagers,
  type ResponsibleManagerEligibilityDeps,
  type ResponsibleManagerMembership,
} from './responsible-manager-eligibility'

const ORG = organizationId('org-1')
const PROPERTY = propertyId('property-1')
const OTHER_PROPERTY = propertyId('property-2')

const admin: ResponsibleManagerMembership = {
  userId: 'admin-1',
  role: 'AccountAdmin',
  propertyAccessScope: 'organization',
}
const manager: ResponsibleManagerMembership = {
  userId: 'manager-1',
  role: 'PropertyManager',
  propertyAccessScope: 'assigned-properties',
}

function depsWith(
  memberships: readonly ResponsibleManagerMembership[],
  grants: Readonly<Record<string, readonly PropertyId[] | null>>,
) {
  const getAccessiblePropertyIds = vi.fn<
    ResponsibleManagerEligibilityDeps['getAccessiblePropertyIds']
  >(async (_org, user) => grants[user] ?? null)
  const deps: ResponsibleManagerEligibilityDeps = {
    listActiveManagers: async () => memberships,
    getAccessiblePropertyIds,
  }
  return { deps, getAccessiblePropertyIds }
}

describe('responsible manager eligibility policy', () => {
  it('treats an AccountAdmin as eligible without any grant lookup', async () => {
    const { deps, getAccessiblePropertyIds } = depsWith([admin], {})

    const eligible = await listEligibleResponsibleManagers(deps, ORG, PROPERTY)

    expect(eligible.map((m) => m.userId)).toEqual(['admin-1'])
    expect(getAccessiblePropertyIds).not.toHaveBeenCalled()
  })

  it('treats a PropertyManager whose grants list the Property as eligible', async () => {
    const { deps } = depsWith([manager], { 'manager-1': [PROPERTY] })

    const eligible = await listEligibleResponsibleManagers(deps, ORG, PROPERTY)

    expect(eligible.map((m) => m.userId)).toEqual(['manager-1'])
  })

  it('asks for the manager grants scoped to the assigned Properties, not organization-wide', async () => {
    const { deps, getAccessiblePropertyIds } = depsWith([manager], {
      'manager-1': [PROPERTY],
    })

    await listEligibleResponsibleManagers(deps, ORG, PROPERTY)

    expect(getAccessiblePropertyIds).toHaveBeenCalledWith(ORG, userId('manager-1'), false)
  })

  it('excludes a PropertyManager whose grants do not list the Property', async () => {
    const { deps } = depsWith([manager], { 'manager-1': [OTHER_PROPERTY] })

    await expect(listEligibleResponsibleManagers(deps, ORG, PROPERTY)).resolves.toEqual(
      [],
    )
  })

  it.each([
    ['an empty grant list', [] as readonly PropertyId[]],
    ['a null grant lookup', null],
  ])('excludes a PropertyManager with %s', async (_label, grants) => {
    const { deps } = depsWith([manager], { 'manager-1': grants })

    await expect(listEligibleResponsibleManagers(deps, ORG, PROPERTY)).resolves.toEqual(
      [],
    )
  })

  it('lists admins and granted managers together and drops the ungranted ones', async () => {
    const ungranted: ResponsibleManagerMembership = { ...manager, userId: 'manager-2' }
    const { deps } = depsWith([admin, manager, ungranted], {
      'manager-1': [PROPERTY],
      'manager-2': [],
    })

    const eligible = await listEligibleResponsibleManagers(deps, ORG, PROPERTY)

    expect(eligible.map((m) => m.userId)).toEqual(['admin-1', 'manager-1'])
  })

  it('agrees with the list in the single-user check', async () => {
    const ungranted: ResponsibleManagerMembership = { ...manager, userId: 'manager-2' }
    const { deps } = depsWith([admin, manager, ungranted], {
      'manager-1': [PROPERTY],
      'manager-2': [OTHER_PROPERTY],
    })

    await expect(
      isEligibleResponsibleManager(deps, ORG, PROPERTY, 'admin-1'),
    ).resolves.toBe(true)
    await expect(
      isEligibleResponsibleManager(deps, ORG, PROPERTY, 'manager-1'),
    ).resolves.toBe(true)
    await expect(
      isEligibleResponsibleManager(deps, ORG, PROPERTY, 'manager-2'),
    ).resolves.toBe(false)
    await expect(
      isEligibleResponsibleManager(deps, ORG, PROPERTY, 'stranger'),
    ).resolves.toBe(false)
  })
})
