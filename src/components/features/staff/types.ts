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
  staffParticipantId: string
  linkedUserId: string | null
  displayName: string
  status: string
  startedAt: string | Date
  endedAt: string | Date | null
  archiveReason: string | null
  revision: number
}>

export type CreateStaffParticipationMutationInput = Readonly<{
  propertyId: string
  displayName: string
}>

export type ArchiveStaffParticipationMutationInput = Readonly<{
  staffParticipationId: string
  reason: string
  expectedRevision: number
}>

export type UpdatePortalResponsibilitiesMutationInput = Readonly<{
  staffParticipationId: string
  primaryPortalId: string
  supportingPortalIds: string[]
  expectedRevision: number
}>

export type PortalResponsibilitySelection = Readonly<{
  staffParticipationId: string
  primaryPortalId: string | null
  supportingPortalIds: ReadonlyArray<string>
  revision: number
}>
