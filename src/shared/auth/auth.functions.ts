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
import { getDb } from '#/shared/db'
import { readUserOrganizationMemberships } from '#/shared/db/user-organization-membership'

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

        const membershipOrganizationIds = await readUserOrganizationMemberships(
          getDb(),
          session.user.id,
        )
        let organization: string | undefined
        let ambiguous = false
        for (const organizationId of membershipOrganizationIds) {
          if (organization === undefined) organization = organizationId
          else if (organizationId !== organization) {
            ambiguous = true
            break
          }
        }
        if (!ambiguous && organization) {
          if (session.session.activeOrganizationId === organization) return
          await auth.api.setActiveOrganization({
            headers,
            body: { organizationId: organization },
          })
        } else {
          getLogger().warn(
            { membershipCount: membershipOrganizationIds.length },
            'User needs exactly one Better Auth Organization membership — cannot set active org',
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
