import type { StaffPeriod } from '../../domain/staff-results-window'
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
      ratingCount?: number
      averageRating?: number
      ratingsCutoff?: string
    }>
  >
  scans(
    scope: StaffResultsScope,
    portalIds: readonly string[],
    period: StaffPeriod,
  ): Promise<ReadonlyMap<string, number>>
  goals(
    scope: StaffResultsScope,
  ): Promise<
    readonly Readonly<{ id: string; name: string; target: number; scans: number }>[]
  >
}>
