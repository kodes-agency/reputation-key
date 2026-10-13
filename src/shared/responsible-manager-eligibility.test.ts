import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, userId, type PropertyId } from '#/shared/domain/ids'
import {
  isEligibleResponsibleManager,
  listEligibleResponsibleManagers,
  listIneligibleResponsibleManagers,
  listPropertyIdsNoLongerEligible,
  releaseRemovedMemberResponsibilities,
  type RemovedMemberRelease,
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

describe('who is no longer an eligible manager', () => {
  it('names the selected users who are not eligible at the Property, in the order given', async () => {
    const ungranted: ResponsibleManagerMembership = { ...manager, userId: 'manager-2' }
    const { deps } = depsWith([admin, manager, ungranted], {
      'manager-1': [PROPERTY],
      'manager-2': [OTHER_PROPERTY],
    })

    await expect(
      listIneligibleResponsibleManagers(deps, ORG, PROPERTY, [
        'stranger',
        'admin-1',
        'manager-2',
        'manager-1',
      ]),
    ).resolves.toEqual(['stranger', 'manager-2'])
  })

  it('names nobody when every selected user is eligible', async () => {
    const { deps } = depsWith([admin, manager], { 'manager-1': [PROPERTY] })

    await expect(
      listIneligibleResponsibleManagers(deps, ORG, PROPERTY, ['admin-1', 'manager-1']),
    ).resolves.toEqual([])
  })

  it('names every Property a user who is gone held a responsibility at, once each', async () => {
    const { deps } = depsWith([admin], {})

    const lostAt = await listPropertyIdsNoLongerEligible(deps, ORG, 'manager-1', [
      'property-1',
      'property-1',
      'property-2',
    ])

    expect([...lostAt]).toEqual(['property-1', 'property-2'])
  })

  it('keeps the Properties a user may still manage, Property by Property', async () => {
    // Removed, then invited again as a PropertyManager of one Property.
    const { deps } = depsWith([admin, manager], { 'manager-1': [PROPERTY] })

    const lostAt = await listPropertyIdsNoLongerEligible(deps, ORG, 'manager-1', [
      'property-1',
      'property-2',
    ])

    expect([...lostAt]).toEqual(['property-2'])
  })

  it('names nothing for a user who holds nothing', async () => {
    const { deps } = depsWith([admin], {})

    const lostAt = await listPropertyIdsNoLongerEligible(deps, ORG, 'manager-1', [])

    expect(lostAt.size).toBe(0)
  })
})

describe('release of what a removed member still holds', () => {
  const REMOVED = { organizationId: 'org-1', userId: 'manager-1', removedBy: 'admin-1' }
  const AT = new Date('2026-10-13T09:00:05.000Z')
  type Held = Readonly<{ id: string; propertyId: string }>

  /** An owner holding these responsibilities for the removed member. */
  function ownerHolding(
    held: readonly Held[],
    memberships: readonly ResponsibleManagerMembership[],
    grants: Readonly<Record<string, readonly PropertyId[] | null>> = {},
  ) {
    let remaining = [...held]
    const releases: RemovedMemberRelease[] = []
    const release = releaseRemovedMemberResponsibilities<Held>({
      eligibility: depsWith(memberships, grants).deps,
      listHeld: async () => remaining,
      releaseHeld: async (asked, lost) => {
        releases.push(asked)
        remaining = remaining.filter((kept) => !lost.includes(kept))
        return { released: lost.length }
      },
      clock: () => AT,
    })
    return { release, releases, remaining: () => remaining.map((kept) => kept.id) }
  }

  const heldAtBoth: readonly Held[] = [
    { id: 'a', propertyId: 'property-1' },
    { id: 'b', propertyId: 'property-1' },
    { id: 'c', propertyId: 'property-2' },
  ]

  it('ends everything a member who is gone still holds, as an offboarding by whoever removed them', async () => {
    const owner = ownerHolding(heldAtBoth, [admin])

    await expect(owner.release(REMOVED)).resolves.toEqual({ released: 3 })

    expect(owner.remaining()).toEqual([])
    expect(owner.releases).toEqual([
      {
        organizationId: 'org-1',
        userId: 'manager-1',
        at: AT,
        endReason: 'manager_offboarded',
        actorId: 'admin-1',
      },
    ])
  })

  it('keeps what a member who is back may hold, Property by Property', async () => {
    // Invited again as a PropertyManager of one Property before the fact arrived.
    const owner = ownerHolding(heldAtBoth, [admin, manager], { 'manager-1': [PROPERTY] })

    await expect(owner.release(REMOVED)).resolves.toEqual({ released: 1 })

    expect(owner.remaining()).toEqual(['a', 'b'])
  })

  it('finds nothing left to end when it runs again', async () => {
    const owner = ownerHolding(heldAtBoth, [admin])

    await owner.release(REMOVED)

    await expect(owner.release(REMOVED)).resolves.toEqual({ released: 0 })
  })
})
