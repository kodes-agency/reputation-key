import { createContext, useContext } from 'react'
import type * as manager from '#/contexts/identity/server/staff-accounts'
import type { listPortals } from '#/contexts/portal/server/portals'
import type { listPortalGroups } from '#/contexts/portal/server/portal-groups'
type Call<T> = T extends (...args: infer A) => infer R ? (...args: A) => R : never
export type StaffAccountFunctions = {
  readonly [K in keyof typeof manager]: Call<(typeof manager)[K]>
} & Readonly<{
  listPortals: Call<typeof listPortals>
  listPortalGroups: Call<typeof listPortalGroups>
}>
const unavailable = async (): Promise<never> => {
  throw new Error('Staff account controls are unavailable.')
}
const DEFAULT: StaffAccountFunctions = {
  checkStaffBatch: unavailable,
  addStaffMember: unavailable,
  removeStaffMember: unavailable,
  renameStaffMember: unavailable,
  resendStaffInvitation: unavailable,
  listStaffMembers: unavailable,
  setColleagueListEnabled: unavailable,
  listPortals: unavailable,
  listPortalGroups: unavailable,
}
export const StaffAccountFunctionsContext = createContext<StaffAccountFunctions>(DEFAULT)
export const useStaffFunctions = () => useContext(StaffAccountFunctionsContext)
