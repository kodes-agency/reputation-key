import { updatePersonalGuestPage } from '#/contexts/portal/server/portal-publish-changes'
import { listMembers } from '#/contexts/identity/server/organizations.query'
import { getPortalResultsOverviewFn } from '#/contexts/reporting/server/portal-results-overview'
import {
  movePortalToGroup,
  removePortalFromGroup,
} from '#/contexts/portal/server/portal-groups'
import { listPortalResponsibleManagers } from '#/contexts/portal/server/portal-responsible-managers'
import {
  changeStaffInvitationEmail,
  checkStaffSource,
  checkStaffBatch,
  addStaffMember,
  removeStaffMember,
  renameStaffMember,
  resendStaffInvitation,
  listStaffMembers,
  setColleagueListEnabled,
} from '#/contexts/identity/server/staff-accounts'
import {
  getPropertyPortalExperience,
  savePropertyPortalBrandContent,
  listPortals,
} from '#/contexts/portal/server/portals'
import { listPortalGroups } from '#/contexts/portal/server/portal-groups'
import type { StaffAccountFunctions } from '#/contexts/identity/staff/ui/accounts/staff-account-functions'
/** Bindings only: constructing the manager shell invokes none of these functions. */
export const STAFF_ACCOUNT_FUNCTIONS: StaffAccountFunctions = {
  changeStaffInvitationEmail,
  checkStaffSource,
  checkStaffBatch,
  addStaffMember,
  removeStaffMember,
  renameStaffMember,
  resendStaffInvitation,
  listStaffMembers,
  setColleagueListEnabled,
  getPropertyPortalExperience,
  savePropertyPortalBrandContent,
  getPortalResultsOverviewFn,
  movePortalToGroup,
  removePortalFromGroup,
  listPortalResponsibleManagers,
  getMonthlyPortalGoalLine: async ({ data }) =>
    (
      await import('./properties/$propertyId/goals/-portal-goal-queries')
    ).readPortalGoalLine(data.propertyId, data.portalId),
  listMembers,
  listPortals,
  listPortalGroups,
  updatePersonalGuestPage,
}
