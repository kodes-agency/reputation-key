// Identity context — accept invitation use case
// Extracted from the server fn (D8-007): the better-auth acceptInvitation call
// + identity.invitation.accepted event emission now live in a use case,
// testable independently. User may not have an org yet (they're joining), so
// there is no AuthContext — the caller resolves auth (userId) and passes headers.

import type { IdentityPort } from '../ports/identity.port'
import type { EventBus } from '#/shared/events/event-bus'
import type { InvitationId, OrganizationId, UserId } from '#/shared/domain/ids'
import { identityInvitationAccepted } from '../../domain/events'
import { emitAndRecord, type OutboxRepository } from '#/shared/outbox'

export type AcceptInvitationDeps = Readonly<{
  identity: IdentityPort
  events: EventBus
  clock: () => Date
  outboxRepo?: OutboxRepository
}>

export type AcceptInvitationInput = Readonly<{
  invitationId: InvitationId
  headers: Headers
  userId: UserId
}>

export type AcceptInvitationResult = Readonly<{
  organizationId: OrganizationId
}>

/** Concrete use case instance type — named, not derived via ReturnType. */
export type AcceptInvitation = (
  input: AcceptInvitationInput,
) => Promise<AcceptInvitationResult>

/**
 * Accept a pending organization invitation.
 *
 * Steps:
 * 1. Persist — delegate to the identity port (better-auth binds the membership)
 * 2. Emit — identity.invitation.accepted event so downstream handlers
 *    (e.g. staff-assignment creation) react.
 */
export const acceptInvitation =
  (deps: AcceptInvitationDeps): AcceptInvitation =>
  async (input) => {
    const { organizationId, propertyIds } = await deps.identity.acceptInvitation(
      input.invitationId,
      input.headers,
    )

    await emitAndRecord(
      deps.events,
      deps.outboxRepo,
      identityInvitationAccepted({
        organizationId,
        userId: input.userId,
        invitationId: input.invitationId,
        propertyIds,
        occurredAt: deps.clock(),
      }),
    )

    return { organizationId }
  }
