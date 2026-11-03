import type { StaffPeriod, StaffResultsSeries } from '../../domain/staff-results-window'
export type StaffResultsScope = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
  timezone: string
  countryCode: string | null
  groupId: string | null
}>
export type StaffResultsReader = Readonly<{
  targetsEnabled: boolean
  results(
    scope: StaffResultsScope,
    period: StaffPeriod,
  ): Promise<
    Readonly<{
      scans: number
      series: StaffResultsSeries | null
      ratingCount?: number
      averageRating?: number
      ratingsCutoff?: string
    }>
  >
  scans(
    scope: StaffResultsScope,
    portalIds: readonly string[],
    period: StaffPeriod,
    /** The instant the period is measured at; `results` passes its own so its columns add up. */
    now?: Date,
  ): Promise<ReadonlyMap<string, number>>
  goals(
    scope: StaffResultsScope,
  ): Promise<
    readonly Readonly<{ id: string; name: string; target: number; scans: number }>[]
  >
}>
