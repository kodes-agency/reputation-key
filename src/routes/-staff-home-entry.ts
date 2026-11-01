import { redirect, isRedirect } from '@tanstack/react-router'
import { getSession } from '#/shared/auth/auth.functions'
import { getMyStaffHome } from '#/contexts/identity/server/staff-self'
import { httpStatus } from '#/shared/security/expected-refusal'

export async function staffHomeEntry(href: string) {
  try {
    const session = await getSession()
    if (!session) throw redirect({ to: '/login', search: { redirect: href } })
    const home = await getMyStaffHome()
    if (home.participations.length === 0) {
      // Staff have no manager shell; this is their no-access boundary.
      // eslint-disable-next-line ui-pattern/unavailable-redirect
      throw redirect({ to: '/unavailable', search: { reason: 'workspace_access' } })
    }
    return { staffHome: home, staffUserId: session.user.id }
  } catch (error) {
    if (isRedirect(error)) throw error
    if (httpStatus(error) === 401) {
      throw redirect({ to: '/login', search: { redirect: href } })
    }
    const status = httpStatus(error)
    if (status === 400 || status === 403 || status === 404) {
      // Staff have no manager shell; this is their no-access boundary.
      // eslint-disable-next-line ui-pattern/unavailable-redirect
      throw redirect({ to: '/unavailable', search: { reason: 'workspace_access' } })
    }
    throw error
  }
}
