// Invitation server functions (accept, cancel, resend, list).
// Per architecture: server/ contains TanStack Start server functions.
// Invitation business logic lives in use cases; server functions resolve auth
// and delegate.

import { createServerFn } from '@tanstack/react-start'
import { command } from '#/shared/commands/command.server'
import { identityCommandErrors } from './organizations.shared'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { requireAuth, resetTenantCache } from '#/shared/auth/middleware'
import { catchUntagged } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { isIdentityError } from '../domain/errors'
import { throwIdentityError } from './organizations.errors.server'
import { invitationId, userId } from '#/shared/domain/ids'
import { acceptInvitationInputSchema } from '../members/invitation.contracts'
import { enforceInvitationSendRateLimit } from './invitation-rate-limit.server'

// ── Accept invitation ──────────────────────────────────────────────
// User may not have an active org yet (they're joining), so we only
// require authentication — not tenant context. The capability decision is
// still taken: the use case asks it for the Organization the invitation names.

export const acceptInvitation = createServerFn({ method: 'POST' })
  .validator(acceptInvitationInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        try {
          const headers = await headersFromContext()
          const user = await requireAuth(headers)

          await getContainer().identityPublicApi.requests.acceptInvitation({
            invitationId: invitationId(data.invitationId),
            headers,
            userId: userId(user.id),
          })
          // Invalidate tenant cache — accepting an invitation changes membership,
          // so any cached AuthContext (role/org) is now stale.
          resetTenantCache()
        } catch (e) {
          if (isIdentityError(e)) throwIdentityError(e)
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
  .validator(acceptInvitationInputSchema)
  .handler(
    command(
      {
        method: 'POST',
        name: 'identity.cancelInvitation',
        action: 'invitation.cancel',
        errors: identityCommandErrors,
      },
      async ({ data, actor: ctx }) => {
        await getContainer().identityPublicApi.requests.cancelInvitation(
          { invitationId: invitationId(data.invitationId) },
          ctx,
        )
      },
    ),
  )

// ── Resend invitation ──────────────────────────────────────────────

export const resendInvitation = createServerFn({ method: 'POST' })
  .validator(acceptInvitationInputSchema)
  .handler(
    command(
      {
        method: 'POST',
        name: 'identity.resendInvitation',
        action: 'invitation.resend',
        errors: identityCommandErrors,
      },
      async ({ data, actor: ctx }) => {
        const { identityPublicApi, rateLimiter, identityRequestSecurity } = getContainer()
        await enforceInvitationSendRateLimit({
          rateLimiter,
          actorId: ctx.userId,
          organizationId: ctx.organizationId,
          keyHmacSecret: identityRequestSecurity.invitationRateLimitHmacSecret,
        })
        // Renews the same invitation, then mails it: { expiresAt, emailSent }.
        return identityPublicApi.requests.resendInvitation(data, ctx)
      },
    ),
  )

// ── List invitations ────────────────────────────────────────────────

export const listInvitations = createServerFn({ method: 'GET' }).handler(
  command(
    {
      method: 'GET',
      name: 'identity.listInvitations',
      action: 'invitation.list',
      errors: identityCommandErrors,
    },
    async ({ actor: ctx }) => {
      return getContainer().identityPublicApi.requests.listInvitations(undefined, ctx)
    },
  ),
)
