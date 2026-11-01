import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffOnboarding, StaffOnboardingStep } from '../../domain/staff-account'

export type StaffAddressFacts = Readonly<{
  userId: string | null
  organizationIds: readonly string[]
  alreadyStaffHere: boolean
  staffParticipantId: string | null
  staffDisplayName?: string
  alreadyInvited: boolean
}>
export type StaffAccountStore = Readonly<{
  withAddressLock<T>(
    organizationId: string,
    email: string,
    run: (store: StaffAccountStore) => Promise<T>,
  ): Promise<T>
  addressFacts(
    organizationId: string,
    propertyId: string,
    email: string,
  ): Promise<StaffAddressFacts>
  findOperation(
    organizationId: string,
    operationId: string,
  ): Promise<StaffOnboarding | null>
  reserve(row: StaffOnboarding): Promise<StaffOnboarding>
  checkpoint(
    id: string,
    step: StaffOnboardingStep,
    status: StaffOnboarding['status'],
    failureCode: string | null,
  ): Promise<StaffOnboarding>
  createPerson(row: StaffOnboarding): Promise<void>
  assignPortal(
    row: StaffOnboarding,
    writePortalName: (transaction: unknown, displayName: string) => Promise<void>,
  ): Promise<void>
  grantAccess(
    row: StaffOnboarding,
    spendInvitationBudget: () => Promise<void>,
  ): Promise<Readonly<{ invited: boolean; userId: string | null }>>
  currentActor(ctx: AuthContext): Promise<AuthContext | null>
  propertyIds(ctx: AuthContext): Promise<readonly string[] | null>
}>
