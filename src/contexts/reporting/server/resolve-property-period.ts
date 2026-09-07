import type { PropertyFactsPublicApi } from '#/contexts/property/application/public-api'
import type { Clock } from '#/shared/domain/clock'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { TimeRangePreset } from '../application/dto/dashboard.dto'
import { timeRangeToDates } from '../application/utils'

type ResolvePropertyPeriodDeps = Readonly<{
  propertyFacts: PropertyFactsPublicApi
  clock: Clock
}>

type ResolvePropertyPeriodInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  timeRange: TimeRangePreset
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
    // Server helpers construct the public error shape without importing a
    // domain error constructor across the server/domain boundary.
    throw {
      _tag: 'DashboardError' as const,
      code: 'not_found' as const,
      message: 'Property timezone unavailable',
    }
  }
  return {
    ...timeRangeToDates(input.timeRange, deps.clock(), timezone),
    propertyTimezone: timezone,
  }
}
