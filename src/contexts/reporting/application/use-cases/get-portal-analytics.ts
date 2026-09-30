// Dashboard context — getPortalAnalytics use case
// Orchestrates portal-scoped queries into a single PortalAnalyticsData response.
// Authorization is enforced at the router/loader level (property ownership). No auth logic here.

import type { OrganizationId, PropertyId, PortalId } from '#/shared/domain/ids'
import type { PortalAnalyticsData } from '../../domain/dashboard-types'
import type {
  PortalAnalyticsRepository,
  PortalMetricSumRow,
} from '../ports/portal-analytics.repository'
import type { TimeRangePreset } from '../dto/dashboard.dto'
import { priorPeriodDates } from '../utils'
import { portalPeriodKpis } from './portal-period-kpis'
import { qualifiedScansSince } from './qualified-scans-since'
import type { PortalLifetimeAggregatePort } from '../ports/portal-lifetime-aggregate.port'
import type { PortalResponseIntegritySummary } from '#/contexts/guest/application/public-api'
import { portalLifetimeAnalyticsData } from './portal-lifetime-analytics'

export type GetPortalAnalyticsInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  startDate: Date
  endDate: Date
  timeRange: TimeRangePreset
  propertyTimezone: string
}>

export type GetPortalAnalyticsDeps = Readonly<{
  portalMetrics: PortalAnalyticsRepository
  portalLifetime: Pick<PortalLifetimeAggregatePort, 'get'>
  responseIntegrity: Readonly<{
    getPortalResponseIntegritySummary(
      input: Readonly<{
        organizationId: OrganizationId
        propertyId: PropertyId
        portalId: PortalId
        startAt: Date
        endAt: Date
      }>,
    ): Promise<PortalResponseIntegritySummary>
  }>
}>
export type GetPortalAnalytics = ReturnType<typeof getPortalAnalytics>

export const getPortalAnalytics =
  (deps: GetPortalAnalyticsDeps) =>
  async (input: GetPortalAnalyticsInput): Promise<PortalAnalyticsData> => {
    const {
      organizationId,
      propertyId,
      portalId,
      startDate,
      endDate,
      timeRange,
      propertyTimezone,
    } = input

    if (timeRange === 'all') {
      const [lifetime, responseIntegrity] = await Promise.all([
        deps.portalLifetime.get({ organizationId, propertyId, portalId }),
        deps.responseIntegrity.getPortalResponseIntegritySummary({
          organizationId,
          propertyId,
          portalId,
          startAt: startDate,
          endAt: endDate,
        }),
      ])
      return portalLifetimeAnalyticsData(
        input,
        lifetime,
        responseIntegrity,
        qualifiedScansSince(),
      )
    }

    // The All Time branch above never reaches the period projection. Every
    // bounded preset receives one equal-length Property-local prior window.
    const priorPeriod = priorPeriodDates(timeRange, startDate, endDate, propertyTimezone)

    // Fetch governed current/prior values and evidence in parallel. The owner
    // API proves whether a zero is complete before Dashboard can render it.
    const [
      currentSums,
      priorSums,
      ratingDistribution,
      ratingTrend,
      responseIntegrity,
      currentEvidence,
      priorEvidence,
    ] = await Promise.all([
      deps.portalMetrics.getPortalKpiSums(
        organizationId,
        propertyId,
        portalId,
        startDate,
        endDate,
      ),
      priorPeriod
        ? deps.portalMetrics.getPortalKpiSums(
            organizationId,
            propertyId,
            portalId,
            priorPeriod.priorStartDate,
            priorPeriod.priorEndDate,
          )
        : Promise.resolve<readonly PortalMetricSumRow[]>([]),
      deps.portalMetrics.getPortalRatingDistribution(
        organizationId,
        propertyId,
        portalId,
        startDate,
        endDate,
      ),
      deps.portalMetrics.getPortalRatingTrend(
        organizationId,
        propertyId,
        portalId,
        startDate,
        endDate,
      ),
      deps.responseIntegrity.getPortalResponseIntegritySummary({
        organizationId,
        propertyId,
        portalId,
        startAt: startDate,
        endAt: endDate,
      }),
      deps.portalMetrics.getPortalMetricEvidence(
        organizationId,
        propertyId,
        portalId,
        startDate,
        endDate,
      ),
      priorPeriod
        ? deps.portalMetrics.getPortalMetricEvidence(
            organizationId,
            propertyId,
            portalId,
            priorPeriod.priorStartDate,
            priorPeriod.priorEndDate,
          )
        : Promise.resolve(null),
    ])

    const since = qualifiedScansSince()
    const { kpis, engagementFunnel, ratingDetailShowable } = portalPeriodKpis(
      { startDate, sums: currentSums, evidence: currentEvidence },
      priorPeriod && priorEvidence
        ? {
            startDate: priorPeriod.priorStartDate,
            sums: priorSums,
            evidence: priorEvidence,
          }
        : null,
      since,
    )

    return {
      period: { startAt: startDate, endAt: endDate, timezone: propertyTimezone },
      qualifiedScansSince: since,
      lifetimeReconciliation: null,
      kpis,
      engagementFunnel,
      // A distribution or daily averages would give a withheld average away.
      ratingDistribution: ratingDetailShowable ? ratingDistribution : [],
      ratingTrend: ratingDetailShowable ? [...ratingTrend] : [],
      responseIntegrity,
    }
  }
