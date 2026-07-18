// Identity context — cancel invitation use case
// Extracted from the server fn (D8-007): the better-auth cancelInvitation call
// + identity.invitation.canceled event emission now live in a use case,
// testable independently. BQC-3.5: the status update and the fact commit in
// ONE transaction via the command store.

import type { IdentityCommandStore } from '../ports/identity-command-store.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { InvitationId } from '#/shared/domain/ids'
import { canForContext } from '#/shared/domain/permissions'
import { identityError } from '../../domain/errors'
import { identityInvitationCanceled } from '../../domain/events'

export type CancelInvitationDeps = Readonly<{
  commandStore: IdentityCommandStore
  clock: () => Date
}>

export type CancelInvitationInput = Readonly<{
  invitationId: InvitationId
}>

/** Concrete use case instance type — named, not derived via ReturnType. */
export type CancelInvitation = (
  input: CancelInvitationInput,
  ctx: AuthContext,
) => Promise<void>

/**
 * Cancel a sent invitation.
 *
 * Steps:
 * 1. Authorize — permission check via centralized can()
 * 2. Persist + emit — command store: status update + canceled fact, atomic
 */
export const cancelInvitation =
  (deps: CancelInvitationDeps): CancelInvitation =>
  async (input, ctx) => {
    // 1. Authorize
    if (!canForContext(ctx, 'invitation.cancel')) {
      throw identityError('forbidden', 'Insufficient role to cancel invitations')
    }

    // 2. Persist + fact — atomic via the command store
    await deps.commandStore.cancelInvitation({
      invitationId: input.invitationId,
      organizationId: ctx.organizationId,
      event: identityInvitationCanceled({
        organizationId: ctx.organizationId,
        invitationId: input.invitationId,
        occurredAt: deps.clock(),
      }),
    })
  }
