// Invitation server functions (accept, cancel, resend, list).
// Per architecture: server/ contains TanStack Start server functions.
// Business logic (better-auth calls + event emission) extracted into use
// cases (D8-007). Server fns resolve auth + delegate.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import {
  requireAuth,
  resolveTenantContext,
  resetTenantCache,
} from '#/shared/auth/middleware'
import { catchUntagged } from '#/shared/auth/server-errors'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { getContainer } from '#/composition'
import { isIdentityError } from '../domain/errors'
import { throwIdentityError } from './organizations.errors.server'
import { invitationId, userId } from '#/shared/domain/ids'
import { acceptInvitationInputSchema } from '../application/dto/invitation.dto'

// ── Accept invitation ──────────────────────────────────────────────
// User may not have an active org yet (they're joining), so we only
// require authentication — not tenant context.

export const acceptInvitation = createServerFn({ method: 'POST' })
  .inputValidator(acceptInvitationInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        try {
          const headers = await headersFromContext()
          const user = await requireAuth(headers)

          const { useCases } = getContainer()
          await useCases.acceptInvitation({
            invitationId: invitationId(data.invitationId),
            headers,
            userId: userId(user.id),
          })
          // Invalidate tenant cache — accepting an invitation changes membership,
          // so any cached AuthContext (role/org) is now stale.
          resetTenantCache()
        } catch (e) {
          throw catchUntagged(e)
        }
      },
      'POST',
      'identity.acceptInvitation',
    ),
  )

// ── Cancel invitation ──────────────────────────────────────────────
// Requires authenticated tenant context — only org members can cancel invitations.

export const cancelInvitation = createServerFn({ method: 'POST' })
  .inputValidator(acceptInvitationInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        try {
          const headers = await headersFromContext()
          const ctx = await resolveTenantContext(headers)
          await requireExecutionAllowed({ actor: ctx, action: 'invitation.cancel' })

          const { useCases } = getContainer()
          await useCases.cancelInvitation(
            { invitationId: invitationId(data.invitationId), headers },
            ctx,
          )
        } catch (e) {
          if (isIdentityError(e)) throwIdentityError(e)
          throw catchUntagged(e)
        }
      },
      'POST',
      'identity.cancelInvitation',
    ),
  )

// ── Resend invitation ──────────────────────────────────────────────

export const resendInvitation = createServerFn({ method: 'POST' })
  .inputValidator(acceptInvitationInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'invitation.resend' })

        try {
          const { useCases } = getContainer()
          await useCases.resendInvitation(data, ctx)
        } catch (e) {
          if (isIdentityError(e)) throwIdentityError(e)
          throw catchUntagged(e)
        }
      },
      'POST',
      'identity.resendInvitation',
    ),
  )

// ── List invitations ────────────────────────────────────────────────

export const listInvitations = createServerFn({ method: 'GET' }).handler(
  tracedHandler(
    async () => {
      const headers = await headersFromContext()
      const ctx = await resolveTenantContext(headers)
      await requireExecutionAllowed({ actor: ctx, action: 'invitation.list' })

      try {
        const { useCases } = getContainer()
        return await useCases.listInvitations(undefined, ctx)
      } catch (e) {
        if (isIdentityError(e)) throwIdentityError(e)
        throw catchUntagged(e)
      }
    },
    'GET',
    'identity.listInvitations',
  ),
)
