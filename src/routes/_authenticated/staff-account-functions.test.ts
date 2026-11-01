import { it, expect, vi } from 'vitest'
import { STAFF_ACCOUNT_FUNCTIONS } from './-staff-account-functions'
const calls = vi.hoisted(() => ({
  checkStaffBatch: vi.fn(),
  addStaffMember: vi.fn(),
  removeStaffMember: vi.fn(),
  renameStaffMember: vi.fn(),
  resendStaffInvitation: vi.fn(),
  listStaffMembers: vi.fn(),
  setColleagueListEnabled: vi.fn(),
  listPortals: vi.fn(),
  listPortalGroups: vi.fn(),
}))
vi.mock('#/contexts/identity/server/staff-accounts', () => ({
  checkStaffBatch: calls.checkStaffBatch,
  addStaffMember: calls.addStaffMember,
  removeStaffMember: calls.removeStaffMember,
  renameStaffMember: calls.renameStaffMember,
  resendStaffInvitation: calls.resendStaffInvitation,
  listStaffMembers: calls.listStaffMembers,
  setColleagueListEnabled: calls.setColleagueListEnabled,
}))
vi.mock('#/contexts/portal/server/portals', () => ({ listPortals: calls.listPortals }))
vi.mock('#/contexts/portal/server/portal-groups', () => ({
  listPortalGroups: calls.listPortalGroups,
}))
it('binding the manager shell starts no staff call', () => {
  expect(STAFF_ACCOUNT_FUNCTIONS).toEqual(calls)
  for (const call of Object.values(calls)) expect(call).not.toHaveBeenCalled()
})
