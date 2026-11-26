// Member Property access server functions: AccountAdmins read and edit which
// Properties each PropertyManager can work, from Members.
// Per architecture: server/ contains TanStack Start server functions.

import { createServerFn } from '@tanstack/react-start'
import { command } from '#/shared/commands/command.server'
import { resetTenantCache } from '#/shared/auth/middleware'
import { getContainer } from '#/composition'
import { isIdentityError } from '../domain/errors'
import { identityCommandErrors } from './organizations.errors.server'
import { setMemberPropertyAccessInputSchema } from '../members/member-access.dto.server'

// ── List member Property access ────────────────────────────────────
// Active grants per member. Deliberately not on listMembers, which
// PropertyManagers also read: they never receive other members' grants.

export const listMemberPropertyAccess = createServerFn({ method: 'GET' }).handler(
  command(
    {
      method: 'GET',
      name: 'identity.listMemberPropertyAccess',
      action: 'member.update',
      errors: identityCommandErrors,
    },
    async ({ actor }) =>
      getContainer().identityPublicApi.requests.listMemberPropertyAccess(
        undefined,
        actor,
      ),
  ),
)

// ── Set member Property access ─────────────────────────────────────
// Returns only the Properties actually granted and revoked.

export const setMemberPropertyAccess = createServerFn({ method: 'POST' })
  .validator(setMemberPropertyAccessInputSchema)
  .handler(
    command(
      {
        method: 'POST',
        name: 'identity.setMemberPropertyAccess',
        action: 'member.update',
        errors: identityCommandErrors,
      },
      async ({ data, actor }) => {
        try {
          const applied =
            await getContainer().identityPublicApi.requests.setMemberPropertyAccess(
              data,
              actor,
            )
          // A grant change alters the member's Property scope; drop cached
          // tenant contexts so no request keeps the stale scope.
          resetTenantCache()
          return applied
        } catch (e) {
          // An Identity refusal changed nothing: the checks run first and the
          // store's refusals roll back its transaction. Anything else may
          // follow a committed change (the responsibility reconcile runs after
          // the commit), so drop the cached scope too.
          if (!isIdentityError(e)) resetTenantCache()
          throw e
        }
      },
    ),
  )
