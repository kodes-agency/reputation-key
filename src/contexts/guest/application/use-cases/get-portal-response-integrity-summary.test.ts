import { describe, expect, it, vi } from 'vitest'
import { getPortalResponseIntegritySummary } from './get-portal-response-integrity-summary'

describe('getPortalResponseIntegritySummary', () => {
  it('delegates one tenant/Property/Portal-scoped half-open period', async () => {
    const summarizePortalIntegrity = vi.fn(async () => ({
      accepted: 7,
      filteredAutomatically: 1,
      underReview: 2,
      total: 10,
    }))
    const getSummary = getPortalResponseIntegritySummary({
      summarizePortalIntegrity,
    })
    const startAt = new Date('2026-08-01T00:00:00.000Z')
    const endAt = new Date('2026-09-01T00:00:00.000Z')

    await expect(
      getSummary({
        organizationId: 'org-1',
        propertyId: 'property-1',
        portalId: 'portal-1',
        startAt,
        endAt,
      }),
    ).resolves.toEqual({
      accepted: 7,
      filteredAutomatically: 1,
      underReview: 2,
      total: 10,
    })
    expect(summarizePortalIntegrity).toHaveBeenCalledWith(
      {
        organizationId: 'org-1',
        propertyId: 'property-1',
        portalId: 'portal-1',
      },
      startAt,
      endAt,
    )
  })

  it('rejects an empty or reversed period before persistence', async () => {
    const summarizePortalIntegrity = vi.fn()
    const getSummary = getPortalResponseIntegritySummary({
      summarizePortalIntegrity,
    })
    const at = new Date('2026-08-01T00:00:00.000Z')

    await expect(
      getSummary({
        organizationId: 'org-1',
        propertyId: 'property-1',
        portalId: 'portal-1',
        startAt: at,
        endAt: at,
      }),
    ).rejects.toThrow('integrity summary period is invalid')
    expect(summarizePortalIntegrity).not.toHaveBeenCalled()
  })
})
