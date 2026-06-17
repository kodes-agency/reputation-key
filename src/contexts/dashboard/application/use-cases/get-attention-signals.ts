// Dashboard context — getAttentionSignals use case.
// Aggregates the five attention-band signals for a property into one response.
// Authorization is enforced at the router/loader level (property ownership).

import type { AttentionSignalsPort } from '../ports/attention-signals.port'
import type { DashboardRepository } from '../ports/dashboard.repository'
import type { AttentionSignals } from '../../domain/types'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { TimeRangePreset } from '../dto/dashboard.dto'

export type GetAttentionSignalsInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  /** Response SLA in hours (org-level setting). */
  slaHours: number
  startDate: Date
  endDate: Date
  timeRange: TimeRangePreset
}>

export type GetAttentionSignalsDeps = Readonly<{
  signals: AttentionSignalsPort
  repo: DashboardRepository
}>

/** Concrete handler type — the curried use case after dependency injection. */
export type GetAttentionSignals = (
  input: GetAttentionSignalsInput,
) => Promise<AttentionSignals>

/** A rating drop is flagged when avg rating falls ≥ 0.3 vs the prior period. */
export const RATING_DROP_THRESHOLD = 0.3

export const getAttentionSignals =
  (deps: GetAttentionSignalsDeps): GetAttentionSignals =>
  async (input) => {
    const { organizationId, propertyId, slaHours, startDate, endDate, timeRange } = input

    // Prior period mirrors getDashboardData so the rating-drop flag is consistent
    // with the KPI strip shown alongside the band. 'all' has no prior period.
    const priorStartDate =
      timeRange === 'all'
        ? startDate
        : new Date(startDate.getTime() - (endDate.getTime() - startDate.getTime()))
    const priorEndDate = timeRange === 'all' ? endDate : new Date(startDate.getTime() - 1)

    const [unanswered, newFeedback, escalated, goalsBehindPace, kpis] = await Promise.all(
      [
        deps.signals.getUnansweredReviewCount(organizationId, propertyId, slaHours),
        deps.signals.getNewInboxItemCount(organizationId, propertyId),
        deps.signals.getEscalatedInboxItemCount(organizationId, propertyId),
        deps.signals.getGoalsBehindPaceCount(organizationId, propertyId),
        deps.repo.getKPIs({
          organizationId,
          propertyId,
          startDate,
          endDate,
          priorStartDate,
          priorEndDate,
        }),
      ],
    )

    // Avoid false positives when there is no prior-period data (priorValue 0).
    const ratingDrop =
      kpis.avgRating.priorValue > 0 &&
      kpis.avgRating.priorValue - kpis.avgRating.value >= RATING_DROP_THRESHOLD

    return { unanswered, newFeedback, goalsBehindPace, ratingDrop, escalated }
  }
