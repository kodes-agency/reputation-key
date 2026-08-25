import type { PortalAnalyticsRepository } from '../ports/portal-analytics.repository'

function assertValidPeriod(startDate: Date, endDate: Date): void {
  if (
    Number.isNaN(startDate.getTime()) ||
    Number.isNaN(endDate.getTime()) ||
    startDate >= endDate
  ) {
    throw new Error('Portal analytics period is invalid')
  }
}

export type PortalAnalyticsQueries = PortalAnalyticsRepository

export function queryPortalAnalytics(
  repository: PortalAnalyticsRepository,
): PortalAnalyticsQueries {
  return {
    getPortalKpiSums: async (...args) => {
      assertValidPeriod(args[3], args[4])
      return repository.getPortalKpiSums(...args)
    },
    getPortalRatingDistribution: async (...args) => {
      assertValidPeriod(args[3], args[4])
      return repository.getPortalRatingDistribution(...args)
    },
    getPortalRatingTrend: async (...args) => {
      assertValidPeriod(args[3], args[4])
      return repository.getPortalRatingTrend(...args)
    },
  }
}
