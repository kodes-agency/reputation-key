import type { changeStaffInvitationEmail } from './change-staff-email.server'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { addStaffMember } from './add-staff-member.server'
import type {
  checkStaffSource,
  checkStaffBatch,
  removeStaffMember,
  renameStaffMember,
  listStaffMembers,
  setColleagueListEnabled,
  resendStaffInvitation,
} from './manage-staff-accounts.server'

export type StaffAccountsApi = Readonly<{
  changeStaffInvitationEmail: ReturnType<typeof changeStaffInvitationEmail>
  checkStaffSource: ReturnType<typeof checkStaffSource>
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
