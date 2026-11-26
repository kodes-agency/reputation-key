import { describe, expect, it } from 'vitest'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import { listEligibleResponsibleManagers } from '#/shared/responsible-manager/responsible-manager-eligibility'
import {
  policyDeps,
  type PortalManagerEligibilityDeps,
} from './portal-manager-eligibility.server'

const listEligiblePortalManagers = (
  deps: PortalManagerEligibilityDeps,
  ...rest: [ReturnType<typeof organizationId>, ReturnType<typeof propertyId>]
) => listEligibleResponsibleManagers(policyDeps(deps), ...rest)

describe('Portal Responsible Manager eligibility', () => {
  it('allows active admins org-wide and requires a current grant for managers', async () => {
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
      {
        userId: 'manager-no-participation',
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
        },
      },
      organizationId('org-1'),
      propertyId('property-1'),
    )

    expect(eligible).toEqual([])
  })
})
