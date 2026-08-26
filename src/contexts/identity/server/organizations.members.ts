// Member management server functions (invite, update role, remove).
// Per architecture: server/ contains TanStack Start server functions.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext, resetTenantCache } from '#/shared/auth/middleware'
import { catchUntagged } from '#/shared/auth/server-errors'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { getContainer } from '#/composition'
import { getEnv } from '#/shared/config/env'
import { isIdentityError } from '../domain/errors'
import { throwIdentityError } from './organizations.errors.server'
import {
  inviteMemberInputSchema,
  updateMemberRoleInputSchema,
  removeMemberInputSchema,
} from '../application/dto/invitation.dto'
import { enforceInvitationSendRateLimit } from './invitation-rate-limit.server'

// ── Invite member ──────────────────────────────────────────────────
// Uses the use case through the composition root.

export const inviteMember = createServerFn({ method: 'POST' })
  .validator(inviteMemberInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'invitation.create' })

        try {
          const { useCases, rateLimiter } = getContainer()
          await enforceInvitationSendRateLimit({
            rateLimiter,
            actorId: ctx.userId,
            organizationId: ctx.organizationId,
            keyHmacSecret: getEnv().BETTER_AUTH_SECRET,
          })
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
  .validator(updateMemberRoleInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'member.update' })

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
  .validator(removeMemberInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'member.delete' })

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
