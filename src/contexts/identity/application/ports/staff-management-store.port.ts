import type { StaffOnboarding } from '../../domain/staff-account'
export type StaffRemovalTarget = Readonly<{
  participationId: string
  propertyId: string
  participantId: string
  portalId: string | null
  userId: string | null
  memberId: string | null
  memberRole: string | null
  otherParticipations: boolean
  active: boolean
  removalComplete: boolean
  email: string | null
}>
export type StaffManagementStore = Readonly<{
  removalsForUser(organizationId: string, userId: string): Promise<readonly string[]>
  target(
    organizationId: string,
    participationId: string,
  ): Promise<StaffRemovalTarget | null>
  denyAccess(organizationId: string, target: StaffRemovalTarget): Promise<void>
  cancelOnboardings(organizationId: string, target: StaffRemovalTarget): Promise<void>
  completeRemoval(organizationId: string, target: StaffRemovalTarget): Promise<void>
  propertiesForParticipant(
    organizationId: string,
    participantId: string,
  ): Promise<readonly string[]>
  rename(
    organizationId: string,
    target: StaffRemovalTarget,
    displayName: string,
    writePortalNames: (
      transaction: unknown,
      portalIds: readonly string[],
    ) => Promise<void>,
    authorizedPropertyIds: readonly string[],
  ): Promise<void>
  list(
    organizationId: string,
    propertyId: string,
  ): Promise<
    readonly Readonly<{
      participationId: string
      operationId: string | null
      displayName: string
      portalId: string | null
      email: string | null
      access: 'active' | 'invited' | 'invite_expired' | 'failed'
      step: string | null
      code: string | null
    }>[]
  >
  setColleagues(
    organizationId: string,
    propertyId: string,
    enabled: boolean,
    actorId: string,
  ): Promise<void>
  renewInvitation(
    organizationId: string,
    participationId: string,
  ): Promise<StaffOnboarding>
}>
