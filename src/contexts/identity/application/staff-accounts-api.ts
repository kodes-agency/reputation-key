import type { AuthContext } from '#/shared/domain/auth-context'
import type { addStaffMember } from './use-cases/add-staff-member'
import type {
  checkStaffBatch,
  removeStaffMember,
  renameStaffMember,
  listStaffMembers,
  setColleagueListEnabled,
  resendStaffInvitation,
} from './use-cases/manage-staff-accounts'

export type StaffAccountsApi = Readonly<{
  checkStaffBatch: ReturnType<typeof checkStaffBatch>
  addStaffMember: ReturnType<typeof addStaffMember>
  removeStaffMember: ReturnType<typeof removeStaffMember>
  renameStaffMember: ReturnType<typeof renameStaffMember>
  listStaffMembers: ReturnType<typeof listStaffMembers>
  setColleagueListEnabled: ReturnType<typeof setColleagueListEnabled>
  resendStaffInvitation: ReturnType<typeof resendStaffInvitation>
  propertyForParticipation(
    participationId: string,
    ctx: AuthContext,
  ): Promise<string | null>
}>
