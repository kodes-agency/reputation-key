import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import { createPortalAnalyticsRepository } from './portal-analytics.repository.server'

const ORG = organizationId('org-portal-analytics-query')
const PROPERTY = propertyId('81000000-0000-4000-8000-000000000001')
const PORTAL = portalId('82000000-0000-4000-8000-000000000001')
const START = new Date('2026-08-01T00:00:00.000Z')
const END = new Date('2026-09-01T00:00:00.000Z')

const invalidPeriods = [
  [START, START],
  [END, START],
  [new Date(Number.NaN), END],
  [START, new Date(Number.NaN)],
] as const

describe('Portal analytics persistence boundary', () => {
  it.each(invalidPeriods)(
    'rejects invalid bounds before any database work: %s to %s',
    async (start, end) => {
      const transaction = vi.fn()
      const select = vi.fn()
      const db = { transaction, select } as unknown as Database
      const repository = createPortalAnalyticsRepository(db, () => END)
      const scope = [ORG, PROPERTY, PORTAL, start, end] as const

      for (const read of [
        () => repository.getPortalTotals(...scope),
        () => repository.getPortalKpiSums(...scope),
        () => repository.getPortalRatingDistribution(...scope),
        () => repository.getPortalWeeklyReadings(...scope, '2026-08-01'),
        () => repository.getPortalMetricEvidence(...scope),
      ]) {
        await expect(read()).rejects.toThrow('Portal analytics period is invalid')
      }
      expect(transaction).not.toHaveBeenCalled()
      expect(select).not.toHaveBeenCalled()
    },
  )
})
