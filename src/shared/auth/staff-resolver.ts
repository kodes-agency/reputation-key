import { getAuth } from './auth'
import { throwAuthError } from './auth-errors'
import { resolveSessionOrganization } from './session-organization'
import { resolveMemberAuthContext } from './tenant-resolver'
import { requireExecutionAllowed } from './execution-policy'

/** No tenant cache: membership and role are read on every staff request. */
export async function resolveStaff(headers: Headers) {
  const { session, activeOrgId } = await resolveSessionOrganization(headers)
  const member = await getAuth().api.getActiveMember({ headers })
  if (!member || !['owner', 'admin', 'member'].includes(member.role)) {
    throwAuthError('forbidden', 'This account has no staff access')
  }
  const { context } = await resolveMemberAuthContext({
    memberRole: member.role,
    organizationId: activeOrgId,
    userId: session.user.id,
  })
  await requireExecutionAllowed({
    actor: context,
    action: 'staff.self',
    capability: 'staff.accounts',
  })
  return context
}
