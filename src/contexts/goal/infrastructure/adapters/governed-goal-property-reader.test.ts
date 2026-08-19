import { describe, expect, it, vi } from 'vitest'
import type { PropertyFactsPublicApi } from '#/contexts/property/application/public-api'
import type { PortalGroupPublicApi } from '#/contexts/portal/application/public-api'
import { createGovernedGoalPropertyReader } from './governed-goal-property-reader'

const ORG_ID = '00000000-0000-4000-8000-000000000001'
const PROPERTY_ID = '00000000-0000-4000-8000-000000000002'
const GROUP_ID = '00000000-0000-4000-8000-000000000003'

describe('createGovernedGoalPropertyReader', () => {
  it('delegates timezone reads with the tenant and property scope intact', async () => {
    const getPropertyTimezone = vi.fn().mockResolvedValue('America/New_York')
    const reader = createGovernedGoalPropertyReader(
      { getPropertyTimezone } as unknown as PropertyFactsPublicApi,
      {} as PortalGroupPublicApi,
    )

    await expect(reader.getTimezone(ORG_ID, PROPERTY_ID)).resolves.toBe(
      'America/New_York',
    )
    expect(getPropertyTimezone).toHaveBeenCalledWith(ORG_ID, PROPERTY_ID)
  })

  it('delegates portal-group membership checks without dropping property scope', async () => {
    const portalGroupBelongsToProperty = vi.fn().mockResolvedValue(true)
    const reader = createGovernedGoalPropertyReader(
      {} as PropertyFactsPublicApi,
      { portalGroupBelongsToProperty } as unknown as PortalGroupPublicApi,
    )

    await expect(
      reader.portalGroupBelongsToProperty(ORG_ID, PROPERTY_ID, GROUP_ID),
    ).resolves.toBe(true)
    expect(portalGroupBelongsToProperty).toHaveBeenCalledWith(
      ORG_ID,
      PROPERTY_ID,
      GROUP_ID,
    )
  })
})
