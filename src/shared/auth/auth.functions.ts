// Server-side auth helpers for TanStack Start route guards.
// Per better-auth TanStack Start docs: use createServerFn + getRequestHeaders
// to check sessions server-side during SSR and client navigation.
// authClient.getSession() only works client-side — it can't forward cookies during SSR.

import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { getAuth } from './auth'
import { getLogger } from '#/shared/observability/logger'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { catchUntagged } from './server-errors'

/** Get the current session using server-side request headers. */
export const getSession = createServerFn({ method: 'GET' }).handler(
  tracedHandler(
    async () => {
      try {
        const headers = getRequestHeaders()
        const session = await getAuth().api.getSession({ headers })
        return session
      } catch (e) {
        catchUntagged(e)
      }
    },
    'GET',
    'auth.getSession',
  ),
)

/** Ensure the user has an active organization set. Sets the first one if missing. */
export const ensureActiveOrg = createServerFn({ method: 'POST' }).handler(
  tracedHandler(
    async () => {
      try {
        const headers = getRequestHeaders()
        const auth = getAuth()

        const session = await auth.api.getSession({ headers })
        if (!session) return

        // Already has active org
        if (session.session.activeOrganizationId) return

        // Find the first org for this user and set it active
        const orgs = await auth.api.listOrganizations({ headers })
        const orgList = Array.isArray(orgs) ? orgs : []
        if (orgList.length > 0) {
          await auth.api.setActiveOrganization({
            headers,
            body: { organizationId: orgList[0].id },
          })
        } else {
          const logger = getLogger()
          logger.warn(
            { userId: session.user.id },
            'User has no organizations — cannot set active org',
          )
        }
      } catch (e) {
        catchUntagged(e)
      }
    },
    'POST',
    'auth.ensureActiveOrg',
  ),
)
