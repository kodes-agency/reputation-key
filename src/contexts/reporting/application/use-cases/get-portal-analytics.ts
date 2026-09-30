// Dashboard context — getPortalAnalytics use case
// Orchestrates portal-scoped queries into a single PortalAnalyticsData response.
// Authorization is enforced at the router/loader level (property ownership). No auth logic here.

import type { OrganizationId, PropertyId, PortalId } from '#/shared/domain/ids'
import type {
  PortalAnalyticsData,
  PortalRatingLanguages,
} from '../../domain/dashboard-types'
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
import type { PortalPublicApi } from '#/contexts/portal/application/public-api'
import { portalLifetimeAnalyticsData } from './portal-lifetime-analytics'
import { PORTAL_RESULTS_THRESHOLDS } from '../../domain/portal-results-thresholds'
import {
  buildPortalResultsSeries,
  localDateOf,
  localDayRange,
  placeVersionMarker,
  type PortalVersionMarker,
} from '../../domain/portal-results-series'

export type GetPortalAnalyticsInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  startDate: Date
  endDate: Date
  timeRange: TimeRangePreset
  propertyTimezone: string
  /** Also read the equal-length window before. Defaults to true. */
  compare?: boolean
}>

type PortalScopedPeriod = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  startAt: Date
  endAt: Date
}>

export type GetPortalAnalyticsDeps = Readonly<{
  portalMetrics: PortalAnalyticsRepository
  portalLifetime: Pick<PortalLifetimeAggregatePort, 'get'>
  /** Guest-owned reads over its responses, through its public API. */
  responseIntegrity: Readonly<{
    getPortalResponseIntegritySummary(
      input: PortalScopedPeriod,
    ): Promise<PortalResponseIntegritySummary>
    getPortalRatingLanguages(input: PortalScopedPeriod): Promise<PortalRatingLanguages>
  }>
  /** Portal-owned: the versions that went live in a window. */
  portalVersions: Pick<PortalPublicApi, 'listPublicationActivationsBetween'>
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
    const scope = { organizationId, propertyId, portalId }

    if (timeRange === 'all') {
      const [lifetime, responseIntegrity, ratingLanguages] = await Promise.all([
        deps.portalLifetime.get({ organizationId, propertyId, portalId }),
        deps.responseIntegrity.getPortalResponseIntegritySummary({
          ...scope,
          startAt: startDate,
          endAt: endDate,
        }),
        deps.responseIntegrity.getPortalRatingLanguages({
          ...scope,
          startAt: startDate,
          endAt: endDate,
        }),
      ])
      return portalLifetimeAnalyticsData(
        input,
        lifetime,
        responseIntegrity,
        ratingLanguages,
        qualifiedScansSince(),
      )
    }

    // The All Time branch above never reaches the period projection. Every
    // bounded preset gets one equal-length Property-local prior window, unless
    // the caller turned the comparison off: then nothing of it is read.
    const priorPeriod =
      input.compare === false
        ? null
        : priorPeriodDates(timeRange, startDate, endDate, propertyTimezone)
    const weekly = (start: Date, end: Date) =>
      deps.portalMetrics.getPortalWeeklyReadings(
        organizationId,
        propertyId,
        portalId,
        start,
        end,
        localDateOf(start, propertyTimezone),
      )
    const kpiSums = (start: Date, end: Date) =>
      deps.portalMetrics.getPortalKpiSums(
        organizationId,
        propertyId,
        portalId,
        start,
        end,
      )
    const evidenceFor = (start: Date, end: Date) =>
      deps.portalMetrics.getPortalMetricEvidence(
        organizationId,
        propertyId,
        portalId,
        start,
        end,
      )

    // Fetch governed current/prior values and evidence in parallel. The owner
    // API proves whether a zero is complete before Dashboard can render it.
    const [
      currentSums,
      priorSums,
      ratingDistribution,
      currentWeekly,
      priorWeekly,
      responseIntegrity,
      ratingLanguages,
      activations,
      currentEvidence,
      priorEvidence,
    ] = await Promise.all([
      kpiSums(startDate, endDate),
      priorPeriod
        ? kpiSums(priorPeriod.priorStartDate, priorPeriod.priorEndDate)
        : Promise.resolve<readonly PortalMetricSumRow[]>([]),
      deps.portalMetrics.getPortalRatingDistribution(
        organizationId,
        propertyId,
        portalId,
        startDate,
        endDate,
      ),
      weekly(startDate, endDate),
      priorPeriod
        ? weekly(priorPeriod.priorStartDate, priorPeriod.priorEndDate)
        : Promise.resolve(null),
      deps.responseIntegrity.getPortalResponseIntegritySummary({
        ...scope,
        startAt: startDate,
        endAt: endDate,
      }),
      deps.responseIntegrity.getPortalRatingLanguages({
        ...scope,
        startAt: startDate,
        endAt: endDate,
      }),
      deps.portalVersions.listPublicationActivationsBetween(
        organizationId,
        propertyId,
        portalId,
        { startAt: startDate, endAt: endDate },
      ),
      evidenceFor(startDate, endDate),
      priorPeriod
        ? evidenceFor(priorPeriod.priorStartDate, priorPeriod.priorEndDate)
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

    // A weekly average would give a withheld average away, exactly as the
    // distribution would, so both follow the same gate.
    const series = buildPortalResultsSeries({
      timezone: propertyTimezone,
      current: { startDate, endDate, rows: currentWeekly },
      prior:
        priorPeriod && priorWeekly
          ? {
              startDate: priorPeriod.priorStartDate,
              endDate: priorPeriod.priorEndDate,
              rows: priorWeekly,
            }
          : null,
      ready: {
        scans: kpis.scans.value !== null,
        ratings: ratingDetailShowable,
        priorScans: kpis.scans.priorValue !== null,
      },
      averageMinSample: PORTAL_RESULTS_THRESHOLDS.averageMinSample,
    })
    const versionMarkers = activations.flatMap((activation): PortalVersionMarker[] => {
      const marker = placeVersionMarker(activation, startDate, endDate, propertyTimezone)
      return marker ? [marker] : []
    })

    const days = localDayRange(startDate, endDate, propertyTimezone)
    const priorDays =
      priorPeriod &&
      localDayRange(
        priorPeriod.priorStartDate,
        priorPeriod.priorEndDate,
        propertyTimezone,
      )

    return {
      period: { startAt: startDate, endAt: endDate, timezone: propertyTimezone },
      localDays: {
        ...days,
        compareStart: priorDays?.start ?? null,
        compareEnd: priorDays?.end ?? null,
      },
      comparePeriod: priorPeriod && {
        startAt: priorPeriod.priorStartDate,
        endAt: priorPeriod.priorEndDate,
      },
      qualifiedScansSince: since,
      lifetimeReconciliation: null,
      kpis,
      engagementFunnel,
      // A distribution or weekly averages would give a withheld average away.
      ratingDistribution: ratingDetailShowable ? ratingDistribution : [],
      series,
      versionMarkers,
      ratingLanguages,
      thresholds: PORTAL_RESULTS_THRESHOLDS,
      responseIntegrity,
    }
  }
