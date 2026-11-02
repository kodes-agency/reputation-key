import {
  checkStaffBatch,
  addStaffMember,
  removeStaffMember,
  renameStaffMember,
  resendStaffInvitation,
  listStaffMembers,
  setColleagueListEnabled,
} from '#/contexts/identity/server/staff-accounts'
import { listPortals } from '#/contexts/portal/server/portals'
import { listPortalGroups } from '#/contexts/portal/server/portal-groups'
import type { StaffAccountFunctions } from '#/components/features/staff/accounts/staff-account-functions'
/** Bindings only: constructing the manager shell invokes none of these functions. */
export const STAFF_ACCOUNT_FUNCTIONS: StaffAccountFunctions = {
  checkStaffBatch,
  addStaffMember,
  removeStaffMember,
  renameStaffMember,
  resendStaffInvitation,
  listStaffMembers,
  setColleagueListEnabled,
  listPortals,
  listPortalGroups,
}
