// Member management server functions (invite, update role, remove).
// Per architecture: server/ contains TanStack Start server functions.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext, resetTenantCache } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { canForContext } from '#/shared/domain/permissions'
import { getContainer } from '#/composition'
import { isIdentityError } from '../domain/errors'
import { throwIdentityError } from './organizations.errors.server'
import {
  inviteMemberInputSchema,
  updateMemberRoleInputSchema,
  removeMemberInputSchema,
} from '../application/dto/invitation.dto'

// ── Invite member ──────────────────────────────────────────────────
// Uses the use case through the composition root.

export const inviteMember = createServerFn({ method: 'POST' })
  .inputValidator(inviteMemberInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!canForContext(ctx, 'invitation.create')) {
          throwContextError(
            'AuthError',
            { code: 'forbidden', message: 'Insufficient permissions to invite members' },
            403,
          )
        }

        try {
          const { useCases } = getContainer()
          await useCases.inviteMember(data, ctx)
        } catch (e) {
          if (isIdentityError(e)) throwIdentityError(e)
          throw catchUntagged(e)
        }
      },
      'POST',
      'identity.inviteMember',
    ),
  )

// ── Update member role ──────────────────────────────────────────────
// Uses the use case through the composition root.

export const updateMemberRole = createServerFn({ method: 'POST' })
  .inputValidator(updateMemberRoleInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!canForContext(ctx, 'member.update')) {
          throwContextError(
            'AuthError',
            {
              code: 'forbidden',
              message: 'Insufficient permissions to update member roles',
            },
            403,
          )
        }

        try {
          const { useCases } = getContainer()
          await useCases.updateMemberRole(data, ctx)
          // Invalidate tenant cache — a role change mutates AuthContext.role,
          // so the affected member's cached permissions are now stale.
          resetTenantCache()
        } catch (e) {
          if (isIdentityError(e)) throwIdentityError(e)
          throw catchUntagged(e)
        }
      },
      'POST',
      'identity.updateMemberRole',
    ),
  )

// ── Remove member ──────────────────────────────────────────────────
// Uses the use case through the composition root.

export const removeMember = createServerFn({ method: 'POST' })
  .inputValidator(removeMemberInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!canForContext(ctx, 'member.delete')) {
          throwContextError(
            'AuthError',
            { code: 'forbidden', message: 'Insufficient permissions to remove members' },
            403,
          )
        }

        try {
          const { useCases } = getContainer()
          await useCases.removeMember(data, ctx)
          // Invalidate tenant cache — removing a member invalidates their cached
          // AuthContext (they may still hold a stale role for up to the TTL).
          resetTenantCache()
        } catch (e) {
          if (isIdentityError(e)) throwIdentityError(e)
          throw catchUntagged(e)
        }
      },
      'POST',
      'identity.removeMember',
    ),
  )
