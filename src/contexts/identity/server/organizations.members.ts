// Member management server functions (invite, update role, remove).
// Per architecture: server/ contains TanStack Start server functions.

import { createServerFn } from '@tanstack/react-start'
import { command } from '#/shared/commands/command.server'
import { resetTenantCache } from '#/shared/auth/middleware'
import { getContainer } from '#/composition'
import { identityCommandErrors } from './organizations.errors.server'
import {
  inviteMemberInputSchema,
  updateMemberRoleInputSchema,
  removeMemberInputSchema,
} from '../members/invitation.contracts'
import { enforceInvitationSendRateLimit } from './invitation-rate-limit.server'

// ── Invite member ──────────────────────────────────────────────────
// Uses the use case through the composition root.

export const inviteMember = createServerFn({ method: 'POST' })
  .validator(inviteMemberInputSchema)
  .handler(
    command(
      {
        method: 'POST',
        name: 'identity.inviteMember',
        action: 'invitation.create',
        errors: identityCommandErrors,
      },
      async ({ data, actor }) => {
        const { identityPublicApi, rateLimiter, identityRequestSecurity } = getContainer()
        await enforceInvitationSendRateLimit({
          rateLimiter,
          actorId: actor.userId,
          organizationId: actor.organizationId,
          keyHmacSecret: identityRequestSecurity.invitationRateLimitHmacSecret,
        })
        // `emailSent: false` means the invitation exists but its email did
        // not go out; the Members page says so and offers Resend.
        return await identityPublicApi.requests.inviteMember(data, actor)
      },
    ),
  )

// ── Update member role ──────────────────────────────────────────────
// Uses the use case through the composition root.

export const updateMemberRole = createServerFn({ method: 'POST' })
  .validator(updateMemberRoleInputSchema)
  .handler(
    command(
      {
        method: 'POST',
        name: 'identity.updateMemberRole',
        action: 'member.update',
        errors: identityCommandErrors,
      },
      async ({ data, actor }) => {
        await getContainer().identityPublicApi.requests.updateMemberRole(data, actor)
        // Invalidate tenant cache — a role change mutates AuthContext.role,
        // so the affected member's cached permissions are now stale.
        resetTenantCache()
      },
    ),
  )

// ── Remove member ──────────────────────────────────────────────────
// Uses the use case through the composition root.

export const removeMember = createServerFn({ method: 'POST' })
  .validator(removeMemberInputSchema)
  .handler(
    command(
      {
        method: 'POST',
        name: 'identity.removeMember',
        action: 'member.delete',
        errors: identityCommandErrors,
      },
      async ({ data, actor }) => {
        await getContainer().identityPublicApi.requests.removeMember(data, actor)
        // Invalidate tenant cache — removing a member invalidates their cached
        // AuthContext (they may still hold a stale role for up to the TTL).
        resetTenantCache()
      },
    ),
  )
