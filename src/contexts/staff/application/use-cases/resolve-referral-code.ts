import type { StaffAssignmentRepository } from '../ports/staff-assignment.repository'
import type { OrganizationId, StaffId } from '#/shared/domain/ids'
import { staffId } from '#/shared/domain/ids'

export type ResolveReferralCodeDeps = Readonly<{
  staffRepo: StaffAssignmentRepository
}>

/**
 * Resolve a referral code to a staff member ID.
 *
 * SECURITY: No `can()` authorization check is needed because this is a public-facing
 * flow — a guest scans a QR code containing a referral code. The orgId parameter is
 * validated indirectly: `findByReferralCode(orgId, code)` scopes the lookup to the
 * given organization, so a valid code in the wrong org returns null.
 * Referral codes themselves are opaque tokens (not guessable).
 */
export const resolveReferralCode =
  (deps: ResolveReferralCodeDeps) =>
  async (orgId: OrganizationId, code: string): Promise<StaffId | null> => {
    const assignment = await deps.staffRepo.findByReferralCode(orgId, code)
    if (!assignment) return null
    return staffId(assignment.userId as string)
  }
