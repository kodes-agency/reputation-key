export type StaffSelfParticipation = Readonly<{
  participationId: string
  propertyId: string
  portalId: string
  propertyName: string
  propertyActive: boolean
  portalState: 'live' | 'paused'
  colleagueListEnabled: boolean
  timezone: string
  countryCode: string | null
  groupId: string | null
}>
export type StaffSelfPerson = Readonly<{
  linkId: string
  participantId: string
  noticeVersion: string | null
  participations: readonly StaffSelfParticipation[]
}>
export type StaffSelfReader = Readonly<{
  find(organizationId: string, userId: string): Promise<StaffSelfPerson | null>
  acknowledge(organizationId: string, userId: string, version: string): Promise<void>
  colleagues(
    organizationId: string,
    propertyId: string,
  ): Promise<
    readonly Readonly<{ participantId: string; displayName: string; portalId: string }>[]
  >
}>
