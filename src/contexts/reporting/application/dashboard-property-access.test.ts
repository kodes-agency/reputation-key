import { describe, expect, it, vi } from 'vitest'
import type { AuthContext } from '#/shared/domain/auth-context'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import { isDashboardError } from '../domain/dashboard-errors'
import { requireDashboardPropertyAccess } from './dashboard-property-access'

const ORG_ID = organizationId('00000000-0000-4000-8000-0000000000d1')
const GRANTED_PROPERTY = propertyId('00000000-0000-4000-8000-0000000000d2')
const OTHER_PROPERTY = propertyId('00000000-0000-4000-8000-0000000000d3')

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

const granting = (...propertyIds: ReadonlyArray<typeof GRANTED_PROPERTY>) =>
  vi.fn(async () => propertyIds)
const on = (...propertyIds: ReadonlyArray<typeof GRANTED_PROPERTY>) => ({
  organizationId: ORG_ID,
  propertyIds,
})

describe('requireDashboardPropertyAccess', () => {
  it('admits a PropertyManager to a granted Property', async () => {
    const grants = granting(GRANTED_PROPERTY)

    await expect(
      requireDashboardPropertyAccess(grants, propertyManager, on(GRANTED_PROPERTY)),
    ).resolves.toBeUndefined()
    expect(grants).toHaveBeenCalledWith(ORG_ID, 'manager-1', false)
  })

  it('refuses an ungranted Property with a tagged DashboardError', async () => {
    const refusal = await requireDashboardPropertyAccess(
      granting(GRANTED_PROPERTY),
      propertyManager,
      on(OTHER_PROPERTY),
    ).catch((error: unknown) => error)

    // The server functions map exactly this to a 403 through isDashboardError.
    expect(refusal).toBeInstanceOf(Error)
    expect(refusal).toMatchObject({
      _tag: 'DashboardError',
      code: 'forbidden',
      message: 'Property not assigned to caller',
    })
    expect(isDashboardError(refusal)).toBe(true)
  })

  it('refuses a roster in which one Property is not granted', async () => {
    await expect(
      requireDashboardPropertyAccess(
        granting(GRANTED_PROPERTY),
        propertyManager,
        on(GRANTED_PROPERTY, OTHER_PROPERTY),
      ),
    ).rejects.toMatchObject({ _tag: 'DashboardError', code: 'forbidden' })
  })

  it('admits an AccountAdmin organization-wide without a grant lookup', async () => {
    const grants = granting()

    await expect(
      requireDashboardPropertyAccess(grants, accountAdmin, on(OTHER_PROPERTY)),
    ).resolves.toBeUndefined()
    expect(grants).not.toHaveBeenCalled()
  })

  it('refuses a reader from another Organization', async () => {
    await expect(
      requireDashboardPropertyAccess(granting(), accountAdmin, {
        organizationId: organizationId('00000000-0000-4000-8000-0000000000e1'),
        propertyIds: [GRANTED_PROPERTY],
      }),
    ).rejects.toMatchObject({ _tag: 'DashboardError', code: 'forbidden' })
  })
})
