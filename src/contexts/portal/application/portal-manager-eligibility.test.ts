import { describe, expect, it } from 'vitest'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import { listEligiblePortalManagers } from './portal-manager-eligibility'

describe('Portal Responsible Manager eligibility', () => {
  it('allows active admins org-wide and requires both grant and participation for managers', async () => {
    const eligible = await listEligiblePortalManagers(
      {
        identityPublicApi: {
          listActiveManagers: async () => [
            {
              userId: 'admin-1',
              role: 'AccountAdmin',
              propertyAccessScope: 'organization',
            },
            {
              userId: 'manager-eligible',
              role: 'PropertyManager',
              propertyAccessScope: 'assigned-properties',
            },
            {
              userId: 'manager-no-participation',
              role: 'PropertyManager',
              propertyAccessScope: 'assigned-properties',
            },
            {
              userId: 'manager-no-grant',
              role: 'PropertyManager',
              propertyAccessScope: 'assigned-properties',
            },
          ],
        },
        staffPublicApi: {
          getAccessiblePropertyIds: async (_org, managerId) =>
            managerId === userId('manager-no-grant') ? [] : [propertyId('property-1')],
          getAssignedPortals: async () => [],
          findActiveParticipation: async (_org, _property, managerId) =>
            managerId === userId('manager-no-participation') ? null : ({} as never),
        },
      },
      organizationId('org-1'),
      propertyId('property-1'),
    )

    expect(eligible).toEqual([
      {
        userId: 'admin-1',
        role: 'AccountAdmin',
        propertyAccessScope: 'organization',
      },
      {
        userId: 'manager-eligible',
        role: 'PropertyManager',
        propertyAccessScope: 'assigned-properties',
      },
    ])
  })

  it('uses current Property authority rather than the display role for bypass decisions', async () => {
    const eligible = await listEligiblePortalManagers(
      {
        identityPublicApi: {
          listActiveManagers: async () => [
            {
              userId: 'stale-admin-label',
              role: 'AccountAdmin',
              propertyAccessScope: 'assigned-properties',
            },
          ],
        },
        staffPublicApi: {
          getAccessiblePropertyIds: async () => [],
          getAssignedPortals: async () => [],
          findActiveParticipation: async () => ({}) as never,
        },
      },
      organizationId('org-1'),
      propertyId('property-1'),
    )

    expect(eligible).toEqual([])
  })
})
