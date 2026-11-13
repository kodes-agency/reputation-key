import { ServerFunctionError } from '#/shared/auth/server-function-error'
import type { StaffAccountFunctions } from './staff-account-functions'
import type { StaffMember } from './staff-account-view'
export async function moveStaffPerson(
  functions: Pick<StaffAccountFunctions, 'movePortalToGroup' | 'removePortalFromGroup'>,
  member: StaffMember,
  group: string,
) {
  if (!member.portalId)
    throw new ServerFunctionError(
      'StaffAccountError',
      'Finish setup before moving this person.',
      'setup_incomplete',
      409,
    )
  if (group !== 'none')
    return functions.movePortalToGroup({
      data: { portalId: member.portalId, portalGroupId: group },
    })
  if (member.group)
    return functions.removePortalFromGroup({
      data: { portalId: member.portalId, portalGroupId: member.group.id },
    })
}
