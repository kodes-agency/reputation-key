// Dashboard context — getFleetOverview use case.
// Cross-property aggregation: per-property attention signals + KPI summary,
// sorted by total attention (most-needing first), plus an org-total strip.
// Authorization + property enumeration happen at the server-fn boundary;
// this use case is pure aggregation over already-scoped property identities.

import type { AttentionSignalsPort } from '../ports/attention-signals.port'
import type { DashboardRepository } from '../ports/dashboard.repository'
import type { AttentionSignals, FleetEntry, FleetOverviewData } from '../../domain/types'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { TimeRangePreset } from '../dto/dashboard.dto'
import { RATING_DROP_THRESHOLD } from './get-attention-signals'

/** Property identity the fleet use case enriches. Resolved server-side. */
export type FleetProperty = Readonly<{
  propertyId: PropertyId
  name: string
  slug: string
  timezone: string
}>

export type GetFleetOverviewInput = Readonly<{
  organizationId: OrganizationId
  properties: readonly FleetProperty[]
  /** Response SLA in hours (org-level setting). */
  slaHours: number
  startDate: Date
  endDate: Date
  timeRange: TimeRangePreset
}>

export type GetFleetOverviewDeps = Readonly<{
  signals: AttentionSignalsPort
  repo: DashboardRepository
}>

export type GetFleetOverview = (
  input: GetFleetOverviewInput,
) => Promise<FleetOverviewData>

export const getFleetOverview =
  (deps: GetFleetOverviewDeps): GetFleetOverview =>
  async (input) => {
    const { organizationId, properties, slaHours, startDate, endDate, timeRange } = input

    // Prior period mirrors getAttentionSignals so the rating-drop flag stays
    // consistent with the per-property deep-dive. 'all' has no prior period.
    const priorStartDate =
      timeRange === 'all'
        ? startDate
        : new Date(startDate.getTime() - (endDate.getTime() - startDate.getTime()))
    const priorEndDate = timeRange === 'all' ? endDate : new Date(startDate.getTime() - 1)

    const entries = await Promise.all(
      properties.map(async (p): Promise<FleetEntry> => {
        // Five parallel queries per property: 4 attention counts + KPIs.
        // KPIs come via repo.getKPIs (ReviewStatsPort + MetricStatsPort).
        const [unanswered, newFeedback, escalated, goalsBehindPace, kpis] =
          await Promise.all([
            deps.signals.getUnansweredReviewCount(organizationId, p.propertyId, slaHours),
            deps.signals.getNewInboxItemCount(organizationId, p.propertyId),
            deps.signals.getEscalatedInboxItemCount(organizationId, p.propertyId),
            deps.signals.getGoalsBehindPaceCount(organizationId, p.propertyId),
            deps.repo.getKPIs({
              organizationId,
              propertyId: p.propertyId,
              startDate,
              endDate,
              priorStartDate,
              priorEndDate,
            }),
          ])

        // Avoid false positives when there is no prior-period data (priorValue 0).
        const ratingDrop =
          kpis.avgRating.priorValue > 0 &&
          kpis.avgRating.priorValue - kpis.avgRating.value >= RATING_DROP_THRESHOLD

        const attentionSignals: AttentionSignals = {
          unanswered,
          newFeedback,
          goalsBehindPace,
          ratingDrop,
          escalated,
        }
        const totalAttention =
          unanswered + newFeedback + goalsBehindPace + (ratingDrop ? 1 : 0) + escalated

        return {
          propertyId: p.propertyId,
          name: p.name,
          slug: p.slug,
          timezone: p.timezone,
          avgRating: kpis.avgRating.value,
          avgRatingTrend: kpis.avgRating.trend,
          reviewCount: kpis.reviews.value,
          feedbackCount: kpis.feedback.value,
          scanCount: kpis.scans.value,
          attentionSignals,
          totalAttention,
        }
      }),
    )

    // Most-needing first.
    const sorted = [...entries].sort((a, b) => b.totalAttention - a.totalAttention)

    const totalAttention = sorted.reduce((sum, e) => sum + e.totalAttention, 0)
    const rated = sorted.filter((e) => e.avgRating > 0)
    const overallAvgRating =
      rated.length > 0 ? rated.reduce((sum, e) => sum + e.avgRating, 0) / rated.length : 0

    return {
      entries: sorted,
      totals: {
        propertyCount: sorted.length,
        totalAttention,
        overallAvgRating,
      },
    }
  }
