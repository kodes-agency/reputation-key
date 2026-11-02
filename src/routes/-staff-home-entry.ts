import type { QueryClient } from '@tanstack/react-query'
import { staffSelfKeys } from '#/shared/queries/query-keys'
import {
  shellContextKeys,
  SHELL_CONTEXT_STALE_MS,
} from '#/shared/queries/shell-context-cache'
import { redirect, isRedirect } from '@tanstack/react-router'
import { getSession } from '#/shared/auth/auth.functions'
import { getMyStaffHome } from '#/contexts/identity/server/staff-self'
import { httpStatus } from '#/shared/security/expected-refusal'

export async function staffHomeEntry(href: string, client?: QueryClient) {
  try {
    const browser = typeof window !== 'undefined' && client
    const session = browser
      ? await client.fetchQuery({
          queryKey: shellContextKeys.session(),
          queryFn: () => getSession(),
          staleTime: SHELL_CONTEXT_STALE_MS,
        })
      : await getSession()
    if (!session) {
      client?.removeQueries({ queryKey: shellContextKeys.session() })
      throw redirect({ to: '/login', search: { redirect: href } })
    }
    const home = browser
      ? await client.fetchQuery({
          queryKey: staffSelfKeys.home(session.user.id),
          queryFn: () => getMyStaffHome(),
          staleTime: SHELL_CONTEXT_STALE_MS,
        })
      : await getMyStaffHome()
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
