import type { listMembers } from '#/contexts/identity/server/organizations.query'
import type { getPortalResultsOverviewFn } from '#/contexts/reporting/server/portal-results-overview'
import type {
  movePortalToGroup,
  removePortalFromGroup,
} from '#/contexts/portal/server/portal-groups'
import type { listPortalResponsibleManagers } from '#/contexts/portal/server/portal-responsible-managers'
import type { getMonthlyPortalGoalLine } from '#/contexts/reporting/server/monthly-portal-goals'
import { createContext, useContext } from 'react'
import type * as manager from '#/contexts/identity/server/staff-accounts'
import type {
  getPropertyPortalExperience,
  savePropertyPortalBrandContent,
} from '#/contexts/portal/server/portals'
import type { listPortals } from '#/contexts/portal/server/portals'
import type { listPortalGroups } from '#/contexts/portal/server/portal-groups'
type Call<T> = T extends (...args: infer A) => infer R ? (...args: A) => R : never
export type StaffAccountFunctions = {
  readonly [K in keyof typeof manager]: Call<(typeof manager)[K]>
} & Readonly<{
  getPropertyPortalExperience: Call<typeof getPropertyPortalExperience>
  savePropertyPortalBrandContent: Call<typeof savePropertyPortalBrandContent>
  getPortalResultsOverviewFn: Call<typeof getPortalResultsOverviewFn>
  movePortalToGroup: Call<typeof movePortalToGroup>
  removePortalFromGroup: Call<typeof removePortalFromGroup>
  listPortalResponsibleManagers: Call<typeof listPortalResponsibleManagers>
  getMonthlyPortalGoalLine: Call<typeof getMonthlyPortalGoalLine>
  listMembers: Call<typeof listMembers>
  listPortals: Call<typeof listPortals>
  listPortalGroups: Call<typeof listPortalGroups>
}>
const unavailable = async (): Promise<never> => {
  throw new Error('Staff account controls are unavailable.')
}
const DEFAULT: StaffAccountFunctions = {
  changeStaffInvitationEmail: unavailable,
  checkStaffSource: unavailable,
  getPropertyPortalExperience: unavailable,
  savePropertyPortalBrandContent: unavailable,
  checkStaffBatch: unavailable,
  addStaffMember: unavailable,
  removeStaffMember: unavailable,
  renameStaffMember: unavailable,
  resendStaffInvitation: unavailable,
  listStaffMembers: unavailable,
  setColleagueListEnabled: unavailable,
  getPortalResultsOverviewFn: unavailable,
  movePortalToGroup: unavailable,
  removePortalFromGroup: unavailable,
  listPortalResponsibleManagers: unavailable,
  getMonthlyPortalGoalLine: unavailable,
  listMembers: unavailable,
  listPortals: unavailable,
  listPortalGroups: unavailable,
}
export const StaffAccountFunctionsContext = createContext<StaffAccountFunctions>(DEFAULT)
export const useStaffFunctions = () => useContext(StaffAccountFunctionsContext)
