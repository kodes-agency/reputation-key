import { describe, expect, it, vi } from 'vitest'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import { isDashboardError } from '../domain/dashboard-errors'
import { assertDashboardPropertyAccessible } from './assert-property-access'

const ORG_ID = organizationId('00000000-0000-4000-8000-0000000000d1')
const GRANTED_PROPERTY = '00000000-0000-4000-8000-0000000000d2'
const OTHER_PROPERTY = '00000000-0000-4000-8000-0000000000d3'

const accountAdmin: AuthContext = {
  organizationId: ORG_ID,
  userId: userId('admin-1'),
  role: 'AccountAdmin',
}
const propertyManager: AuthContext = {
  organizationId: ORG_ID,
  userId: userId('manager-1'),
  role: 'PropertyManager',
}

function peopleGranting(...propertyIds: readonly string[]) {
  return {
    getAccessiblePropertyIds: vi.fn(async () => propertyIds.map(propertyId)),
    getAssignedPortals: vi.fn(async () => []),
  } satisfies StaffPublicApi
}

describe('assertDashboardPropertyAccessible', () => {
  it('admits a PropertyManager to a granted Property', async () => {
    const people = peopleGranting(GRANTED_PROPERTY)

    await expect(
      assertDashboardPropertyAccessible(people, propertyManager, GRANTED_PROPERTY),
    ).resolves.toBeUndefined()
    expect(people.getAccessiblePropertyIds).toHaveBeenCalledWith(
      ORG_ID,
      'manager-1',
      false,
    )
  })

  it('refuses an ungranted Property with the DashboardError forbidden shape', async () => {
    const people = peopleGranting(GRANTED_PROPERTY)

    const refusal = await assertDashboardPropertyAccessible(
      people,
      propertyManager,
      OTHER_PROPERTY,
    ).catch((error: unknown) => error)

    // The server functions map exactly this shape to a 403 through isDashboardError.
    expect(refusal).toEqual({
      _tag: 'DashboardError',
      code: 'forbidden',
      message: 'Property not assigned to caller',
    })
    expect(isDashboardError(refusal)).toBe(true)
  })

  it('admits an AccountAdmin organization-wide without a grant lookup', async () => {
    const people = peopleGranting()

    await expect(
      assertDashboardPropertyAccessible(people, accountAdmin, OTHER_PROPERTY),
    ).resolves.toBeUndefined()
    expect(people.getAccessiblePropertyIds).not.toHaveBeenCalled()
  })
})
