import { describe, expect, it, vi } from 'vitest'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import type { PortalAnalyticsRepository } from '../ports/portal-analytics.repository'
import { queryPortalAnalytics } from './query-portal-analytics'

const ORG = organizationId('org-portal-analytics-query')
const PROPERTY = propertyId('81000000-0000-4000-8000-000000000001')
const PORTAL = portalId('82000000-0000-4000-8000-000000000001')
const START = new Date('2026-08-01T00:00:00.000Z')
const END = new Date('2026-09-01T00:00:00.000Z')

function repository(): PortalAnalyticsRepository {
  return {
    getPortalKpiSums: vi.fn(async () => []),
    getPortalRatingDistribution: vi.fn(async () => []),
    getPortalRatingTrend: vi.fn(async () => []),
  }
}

describe('queryPortalAnalytics', () => {
  it('delegates exact tenant, Property, Portal, and half-open bounds', async () => {
    const repo = repository()
    const queries = queryPortalAnalytics(repo)

    await queries.getPortalKpiSums(ORG, PROPERTY, PORTAL, START, END)

    expect(repo.getPortalKpiSums).toHaveBeenCalledWith(ORG, PROPERTY, PORTAL, START, END)
  })

  it('rejects empty, reversed, or invalid periods before persistence', async () => {
    const repo = repository()
    const queries = queryPortalAnalytics(repo)

    await expect(
      queries.getPortalRatingTrend(ORG, PROPERTY, PORTAL, END, START),
    ).rejects.toThrow('Portal analytics period is invalid')
    await expect(
      queries.getPortalRatingDistribution(
        ORG,
        PROPERTY,
        PORTAL,
        new Date(Number.NaN),
        END,
      ),
    ).rejects.toThrow('Portal analytics period is invalid')
    expect(repo.getPortalRatingTrend).not.toHaveBeenCalled()
    expect(repo.getPortalRatingDistribution).not.toHaveBeenCalled()
  })
})
