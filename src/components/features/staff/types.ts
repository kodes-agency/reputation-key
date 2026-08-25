/** Client-safe view and command models for Staff participation UI. */

export type MemberOption = Readonly<{
  userId: string
  name: string
  email: string
}>

export type StaffParticipationView = Readonly<{
  id: string
  organizationId: string
  propertyId: string
  userId: string
  displayName: string
  status: string
  startedAt: string | Date
  endedAt: string | Date | null
}>

export type CreateStaffParticipationMutationInput = Readonly<{
  propertyId: string
  userId: string
  displayName: string
}>

export type ArchiveStaffParticipationMutationInput = Readonly<{
  staffParticipationId: string
  reason: string
}>

export type UpdatePortalResponsibilitiesMutationInput = Readonly<{
  staffParticipationId: string
  primaryPortalId: string
  supportingPortalIds: string[]
}>

export type PortalResponsibilitySelection = Readonly<{
  staffParticipationId: string
  primaryPortalId: string | null
  supportingPortalIds: ReadonlyArray<string>
}>
