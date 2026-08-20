/** Client-safe view models shared by People and Team UI. */

export type MemberOption = Readonly<{
  userId: string
  name: string
  email: string
}>

export type TeamSummary = Readonly<{
  id: string
  organizationId: string
  propertyId: string
  name: string
  description: string | null
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

export type TeamMembershipView = Readonly<{
  id: string
  organizationId: string
  propertyId: string
  teamId: string
  staffParticipationId: string
  userId: string
  displayName: string
  role: 'member' | 'lead'
  effectiveFrom: string | Date
  effectiveTo: string | Date | null
}>

export type CreateTeamMutationInput = Readonly<{
  propertyId: string
  name: string
  description?: string
}>

export type UpdateTeamMutationInput = Readonly<{
  teamId: string
  name: string
  description: string | null
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
