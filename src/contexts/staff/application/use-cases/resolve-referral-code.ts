import type { StaffAssignmentRepository } from '../ports/staff-assignment.repository'
import type { OrganizationId, StaffId } from '#/shared/domain/ids'
import { staffId } from '#/shared/domain/ids'

export type ResolveReferralCodeDeps = Readonly<{
  staffRepo: StaffAssignmentRepository
}>

export const resolveReferralCode =
  (deps: ResolveReferralCodeDeps) =>
  async (orgId: OrganizationId, code: string): Promise<StaffId | null> => {
    const assignment = await deps.staffRepo.findByReferralCode(orgId, code)
    if (!assignment) return null
    return staffId(assignment.userId as string)
  }
