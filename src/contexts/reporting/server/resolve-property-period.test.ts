import { describe, expect, it, vi } from 'vitest'
import type { PropertyFactsPublicApi } from '#/contexts/property/application/public-api'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { resolvePropertyPeriod } from './resolve-property-period'

const ORGANIZATION = organizationId('org-test')
const PROPERTY = propertyId('a0000000-0000-4000-8000-000000000001')
const NOW = new Date('2026-03-20T16:00:00.000Z')

describe('resolvePropertyPeriod', () => {
  it('uses the trusted Property timezone for the requested calendar window', async () => {
    const getPropertyTimezone = vi.fn(async () => 'America/New_York')
    const propertyFacts = { getPropertyTimezone } satisfies PropertyFactsPublicApi

    await expect(
      resolvePropertyPeriod(
        { propertyFacts, clock: () => NOW },
        {
          organizationId: ORGANIZATION,
          propertyId: PROPERTY,
          timeRange: '30d',
        },
      ),
    ).resolves.toEqual({
      startDate: new Date('2026-02-18T17:00:00.000Z'),
      endDate: NOW,
      propertyTimezone: 'America/New_York',
    })
    expect(getPropertyTimezone).toHaveBeenCalledWith(ORGANIZATION, PROPERTY)
  })

  it('fails closed when the Property timezone cannot be resolved', async () => {
    const propertyFacts = {
      getPropertyTimezone: vi.fn(async () => null),
    } satisfies PropertyFactsPublicApi

    await expect(
      resolvePropertyPeriod(
        { propertyFacts, clock: () => NOW },
        {
          organizationId: ORGANIZATION,
          propertyId: PROPERTY,
          timeRange: '30d',
        },
      ),
    ).rejects.toMatchObject({
      _tag: 'DashboardError',
      code: 'not_found',
    })
  })
})
