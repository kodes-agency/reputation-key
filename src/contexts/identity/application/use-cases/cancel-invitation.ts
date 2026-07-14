// Identity context — cancel invitation use case
// Extracted from the server fn (D8-007): the better-auth cancelInvitation call
// + identity.invitation.canceled event emission now live in a use case,
// testable independently.

import type { IdentityPort } from '../ports/identity.port'
import type { EventBus } from '#/shared/events/event-bus'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { InvitationId } from '#/shared/domain/ids'
import { canForContext } from '#/shared/domain/permissions'
import { identityError } from '../../domain/errors'
import { identityInvitationCanceled } from '../../domain/events'
import { emitAndRecord } from '#/shared/outbox/emit-and-record'
import type { OutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'

export type CancelInvitationDeps = Readonly<{
  identity: IdentityPort
  events: EventBus
  clock: () => Date
  outboxRepo?: OutboxRepository
}>

export type CancelInvitationInput = Readonly<{
  invitationId: InvitationId
  headers: Headers
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
 * 2. Persist — delegate to the identity port
 * 3. Emit — identity.invitation.canceled event
 */
export const cancelInvitation =
  (deps: CancelInvitationDeps): CancelInvitation =>
  async (input, ctx) => {
    // 1. Authorize
    if (!canForContext(ctx, 'invitation.cancel')) {
      throw identityError('forbidden', 'Insufficient role to cancel invitations')
    }

    // 2. Persist
    await deps.identity.cancelInvitation(input.invitationId, input.headers)

    // 3. Emit
    await emitAndRecord(
      deps.events,
      deps.outboxRepo,
      identityInvitationCanceled({
        organizationId: ctx.organizationId,
        invitationId: input.invitationId,
        occurredAt: deps.clock(),
      }),
    )
  }
