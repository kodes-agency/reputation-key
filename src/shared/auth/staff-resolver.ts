import { getAuth } from './auth'
import { throwAuthError } from './auth-errors'
import { resolveSessionOrganization } from './session-organization'
import { resolveMemberAuthContext } from './tenant-resolver'
import { requireExecutionAllowed } from './execution-policy'
import { enterTenantScope, withTenantScope } from '#/shared/db/tenant-scope.server'
import { getSpanAttrs } from '#/shared/observability/request-context'

/**
 * No tenant cache: membership and role are read on every staff request. They
 * are read under the Organization the session names, and the rest of the
 * request runs under it once they prove the session belongs there.
 */
export async function resolveStaff(headers: Headers) {
  const { session, activeOrgId } = await resolveSessionOrganization(headers)
  const scope = {
    organizationId: activeOrgId,
    entry: 'session',
    name: getSpanAttrs().useCase ?? 'session',
  } as const
  const context = await withTenantScope(scope, async () => {
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
  })
  enterTenantScope(scope)
  return context
}
