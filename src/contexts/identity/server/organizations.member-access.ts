// Member Property access server functions: AccountAdmins read and edit which
// Properties each PropertyManager can work, from Members.
// Per architecture: server/ contains TanStack Start server functions.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext, resetTenantCache } from '#/shared/auth/middleware'
import { catchUntagged } from '#/shared/auth/server-errors'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { getContainer } from '#/composition'
import { isIdentityError } from '../domain/errors'
import { throwIdentityError } from './organizations.errors.server'
import { setMemberPropertyAccessInputSchema } from '../application/dto/member-access.dto'

// ── List member Property access ────────────────────────────────────
// Active grants per member. Deliberately not on listMembers, which
// PropertyManagers also read: they never receive other members' grants.

export const listMemberPropertyAccess = createServerFn({ method: 'GET' }).handler(
  tracedHandler(
    async () => {
      const headers = await headersFromContext()
      const ctx = await resolveTenantContext(headers)
      await requireExecutionAllowed({ actor: ctx, action: 'member.update' })

      try {
        return await getContainer().identityPublicApi.requests.listMemberPropertyAccess(
          undefined,
          ctx,
        )
      } catch (e) {
        if (isIdentityError(e)) throwIdentityError(e)
        throw catchUntagged(e)
      }
    },
    'GET',
    'identity.listMemberPropertyAccess',
  ),
)

// ── Set member Property access ─────────────────────────────────────
// Returns only the Properties actually granted and revoked.

export const setMemberPropertyAccess = createServerFn({ method: 'POST' })
  .validator(setMemberPropertyAccessInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'member.update' })

        try {
          const applied =
            await getContainer().identityPublicApi.requests.setMemberPropertyAccess(
              data,
              ctx,
            )
          // A grant change alters the member's Property scope; drop cached
          // tenant contexts so no request keeps the stale scope.
          resetTenantCache()
          return applied
        } catch (e) {
          // An Identity refusal changed nothing: the checks run first and the
          // store's refusals roll back its transaction.
          if (isIdentityError(e)) throwIdentityError(e)
          // Anything else may follow a committed change (the responsibility
          // reconcile runs after the commit), so drop the cached scope too.
          resetTenantCache()
          throw catchUntagged(e)
        }
      },
      'POST',
      'identity.setMemberPropertyAccess',
    ),
  )
