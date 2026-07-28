// Dashboard context — getAttentionSignals use case.
// Aggregates the five attention-band signals for a property into one response.
// Authorization is enforced at the router/loader level (property ownership).

import type { AttentionSignalsPort } from '../ports/attention-signals.port'
import type { DashboardRepository } from '../ports/dashboard.repository'
import type { AttentionSignals } from '../../domain/types'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { TimeRangePreset } from '../dto/dashboard.dto'
import { isRatingDrop, priorPeriodDates } from '../utils'

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
  clock: () => Date
}>

/** Concrete handler type — the curried use case after dependency injection. */
export type GetAttentionSignals = (
  input: GetAttentionSignalsInput,
) => Promise<AttentionSignals>

export const getAttentionSignals =
  (deps: GetAttentionSignalsDeps): GetAttentionSignals =>
  async (input) => {
    const { organizationId, propertyId, slaHours, startDate, endDate, timeRange } = input

    // Prior period mirrors getDashboardData so the rating-drop flag is consistent
    // with the KPI strip shown alongside the band. 'all' has no prior period.
    const { priorStartDate, priorEndDate } = priorPeriodDates(
      timeRange,
      startDate,
      endDate,
    )

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

    const ratingDrop = isRatingDrop(kpis.avgRating.value, kpis.avgRating.priorValue)

    return { unanswered, newFeedback, goalsBehindPace, ratingDrop, escalated }
  }
