import type { GuestInteractionRepository } from '../ports/guest-interaction.repository'
import type { StaffId, OrganizationId } from '#/shared/domain/ids'

export type GetStaffIdForSessionDeps = Readonly<{
  guestRepo: GuestInteractionRepository
}>

export const getStaffIdForSession =
  (deps: GetStaffIdForSessionDeps) =>
  async (organizationId: OrganizationId, sessionId: string): Promise<StaffId | null> => {
    const scan = await deps.guestRepo.getLatestScanBySession(organizationId, sessionId)
    return scan?.staffId ?? null
  }
