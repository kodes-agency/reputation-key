import { expect, it, vi } from 'vitest'
import { moveStaffPerson } from './staff-group-actions'
import type { StaffMember } from './staff-account-view'
import type { StaffAccountFunctions } from './staff-account-functions'
const member: StaffMember = {
  participationId: 'person',
  displayName: 'Ana',
  portalId: 'portal',
  operationId: null,
  access: 'active',
  code: null,
  step: null,
  group: { id: 'desk', name: 'Reception' },
}
it('uses the existing single-Portal move and removal commands', async () => {
  const movePortalToGroup = vi
    .fn<StaffAccountFunctions['movePortalToGroup']>()
    .mockResolvedValue({} as never)
  const removePortalFromGroup = vi
    .fn<StaffAccountFunctions['removePortalFromGroup']>()
    .mockResolvedValue({} as never)
  const functions = { movePortalToGroup, removePortalFromGroup }
  await moveStaffPerson(functions, member, 'bar')
  expect(movePortalToGroup).toHaveBeenCalledWith({
    data: { portalId: 'portal', portalGroupId: 'bar' },
  })
  await moveStaffPerson(functions, member, 'none')
  expect(removePortalFromGroup).toHaveBeenCalledWith({
    data: { portalId: 'portal', portalGroupId: 'desk' },
  })
  await expect(
    moveStaffPerson(functions, { ...member, portalId: null }, 'bar'),
  ).rejects.toThrow('Finish setup before moving this person.')
})
