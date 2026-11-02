import { createElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { setupHookRoot } from '#/shared/testing/hook-root'
import { StaffAccountsProvider } from '#/components/features/staff/accounts/staff-accounts-provider'
import { StaffAccountFunctionsContext } from '#/components/features/staff/accounts/staff-account-functions'
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

vi.mock('#/shared/hooks/useCapabilities', () => ({
  useCapabilities: () => ({ all: [], has: () => false }),
}))
vi.mock('#/shared/hooks/usePermissions', () => ({
  usePermissions: () => ({ can: () => true }),
}))
const root = setupHookRoot()
it('the capability-off shell binding makes no staff request through a client QueryClient', async () => {
  vi.clearAllMocks()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await root.render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        StaffAccountFunctionsContext,
        { value: STAFF_ACCOUNT_FUNCTIONS },
        createElement(StaffAccountsProvider, { propertyId: 'p', children: null }),
      ),
    ),
  )
  for (const call of Object.values(calls)) expect(call).not.toHaveBeenCalled()
  client.clear()
})
