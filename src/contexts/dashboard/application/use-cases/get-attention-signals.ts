// Dashboard context — getAttentionSignals use case.
// Aggregates the five attention-band reasons plus their distinct work total.
// Authorization is enforced at the router/loader level (property ownership).

import type { AttentionSignalsPort } from '../ports/attention-signals.port'
import type { DashboardRepository } from '../ports/dashboard.repository'
import type { AttentionSignals } from '../../domain/types'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { TimeRangePreset } from '../dto/dashboard.dto'
import { priorPeriodDates, ratingComparison } from '../utils'

export type GetAttentionSignalsInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  /** Response SLA in hours (org-level setting). */
  slaHours: number
  startDate: Date
  endDate: Date
  timeRange: TimeRangePreset
  propertyTimezone: string
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
    const {
      organizationId,
      propertyId,
      slaHours,
      startDate,
      endDate,
      timeRange,
      propertyTimezone,
    } = input

    // Keep the attention band aligned with the KPI strip. An all-time window
    // has no meaningful predecessor, so the repository receives no comparison.
    const comparisonPeriod = priorPeriodDates(
      timeRange,
      startDate,
      endDate,
      propertyTimezone,
    )

    const [counts, kpis] = await Promise.all([
      deps.signals.getAttentionCounts(organizationId, propertyId, slaHours),
      deps.repo.getKPIs({
        organizationId,
        propertyId,
        startDate,
        endDate,
        comparisonPeriod,
      }),
    ])

    const comparison = ratingComparison(
      kpis.avgRating.value,
      kpis.reviews.value,
      kpis.avgRating.priorValue,
      kpis.reviews.priorValue,
    )
    const ratingDrop = comparison !== null && comparison <= -0.3

    return {
      unanswered: counts.unanswered,
      itemsToTriage: counts.itemsToTriage,
      goalsBehindPace: counts.goalsBehindPace,
      ratingDrop,
      escalated: counts.escalated,
      needsAttention: counts.attentionWork + (ratingDrop ? 1 : 0),
    }
  }
