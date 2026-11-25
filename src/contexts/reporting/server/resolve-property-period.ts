import { dashboardError } from '../domain/dashboard-errors'
import type { PropertyFactsPublicApi } from '#/contexts/property/public-api'
import type { Clock } from '#/shared/domain/clock'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { TimeRangePreset } from '../property-overview/contracts'
import { localDaysWindow, timeRangeToDates } from '../portal-results/time-range.server'

type ResolvePropertyPeriodDeps = Readonly<{
  propertyFacts: PropertyFactsPublicApi
  clock: Clock
}>

type ResolvePropertyPeriodInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  timeRange: TimeRangePreset
  /**
   * Open the window at Property-local midnight and count today as a day, as the
   * Portal Results tab does, instead of rolling back from the current instant.
   */
  wholeLocalDays?: boolean
}>

/** Resolve Dashboard time windows from the trusted Property-owned timezone. */
export async function resolvePropertyPeriod(
  deps: ResolvePropertyPeriodDeps,
  input: ResolvePropertyPeriodInput,
) {
  const timezone = await deps.propertyFacts.getPropertyTimezone(
    input.organizationId,
    input.propertyId,
  )
  if (!timezone) {
    throw dashboardError('not_found', 'Property timezone unavailable')
  }
  return {
    ...(input.wholeLocalDays === true ? localDaysWindow : timeRangeToDates)(
      input.timeRange,
      deps.clock(),
      timezone,
    ),
    propertyTimezone: timezone,
  }
}
