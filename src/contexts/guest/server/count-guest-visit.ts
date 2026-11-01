import { getAuth } from '#/shared/auth/auth'
import { checkUserOrganizationMembership } from '#/shared/auth/user-organization-membership-authority'

/** Anonymous guests pay no auth lookup. A failed lookup preserves observation. */
export async function shouldCountGuestVisit(
  headers: Headers,
  organizationId: string,
): Promise<boolean> {
  if (
    !(headers.get('cookie') ?? '')
      .split(';')
      .some((pair) => /^(?:__Secure-)?better-auth\.session_token=.+/.test(pair.trim()))
  )
    return true
  try {
    const session = await getAuth().api.getSession({ headers })
    if (!session) return true
    const membership = await checkUserOrganizationMembership(
      session.user.id,
      organizationId,
    )
    return membership.kind !== 'allow'
  } catch {
    return true
  }
}
