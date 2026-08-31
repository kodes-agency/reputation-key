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
import { readUserOrganizationBinding } from '#/shared/db/user-organization-binding'

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

        const binding = await readUserOrganizationBinding(getDb(), session.user.id)
        if (binding?.state === 'active' && binding.organizationId) {
          if (session.session.activeOrganizationId === binding.organizationId) return
          await auth.api.setActiveOrganization({
            headers,
            body: { organizationId: binding.organizationId },
          })
        } else {
          const logger = getLogger()
          logger.warn(
            { bindingState: binding?.state ?? 'missing' },
            'User has no active beta Organization binding — cannot set active org',
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
