import { describe, expect, it } from 'vitest'
import { METRIC_VERSION_IDS } from '../domain/metric-registry'
import { createMetricRegistryRepository } from './repositories/metric-registry.repository'

describe('createMetricRegistryRepository', () => {
  it('fails closed for an unknown registry version', async () => {
    await expect(
      createMetricRegistryRepository().findVersionById('version-missing'),
    ).resolves.toBeNull()
  })

  it('returns the code-reviewed policy for a pinned version', async () => {
    await expect(
      createMetricRegistryRepository().findVersionById(
        METRIC_VERSION_IDS.portalRatingAverageGoal,
      ),
    ).resolves.toEqual({
      definition: expect.objectContaining({
        id: '11111111-1111-4111-8111-111111110303',
        key: 'portal.rating_average',
        name: 'Portal rating average',
        privacyClass: 'deidentified_guest_gateway_numeric',
      }),
      version: expect.objectContaining({
        id: METRIC_VERSION_IDS.portalRatingAverageGoal,
        effectiveFrom: new Date('2026-08-25T00:00:00.000Z'),
        unit: 'star',
        precision: 1,
        minimumSample: 10,
        sourcePolicyAllowlist: ['first_party_guest_gateway_metric'],
        permittedConsumers: [
          'dashboard',
          'goal',
          'notification',
          'export',
          'portal_analytics',
        ],
        employmentDecisionEligible: false,
      }),
    })
  })
})
