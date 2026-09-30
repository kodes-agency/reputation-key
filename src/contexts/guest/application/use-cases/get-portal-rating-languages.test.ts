import { describe, expect, it, vi } from 'vitest'
import { getPortalRatingLanguages } from './get-portal-rating-languages'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'

const scope = {
  organizationId: organizationId('org-1'),
  propertyId: propertyId('property-1'),
  portalId: portalId('portal-1'),
}

describe('getPortalRatingLanguages', () => {
  it('delegates one tenant/Property/Portal-scoped half-open period', async () => {
    const breakdown = {
      total: 3,
      languages: [{ locale: 'en', count: 2 }],
      unrecorded: 1,
    }
    const summarizePortalRatingLanguages = vi.fn(async () => breakdown)
    const read = getPortalRatingLanguages({ summarizePortalRatingLanguages })
    const startAt = new Date('2026-08-01T00:00:00.000Z')
    const endAt = new Date('2026-09-01T00:00:00.000Z')

    await expect(read({ ...scope, startAt, endAt })).resolves.toEqual(breakdown)
    expect(summarizePortalRatingLanguages).toHaveBeenCalledWith(
      { organizationId: 'org-1', propertyId: 'property-1', portalId: 'portal-1' },
      startAt,
      endAt,
    )
  })

  it('rejects an empty or reversed period before persistence', async () => {
    const summarizePortalRatingLanguages = vi.fn()
    const read = getPortalRatingLanguages({ summarizePortalRatingLanguages })
    const at = new Date('2026-08-01T00:00:00.000Z')

    await expect(read({ ...scope, startAt: at, endAt: at })).rejects.toThrow(
      'rating languages period is invalid',
    )
    expect(summarizePortalRatingLanguages).not.toHaveBeenCalled()
  })
})
